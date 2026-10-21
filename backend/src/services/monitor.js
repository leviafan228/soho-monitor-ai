// Фоновий моніторинг: опитування роутерів, фіксація аварій, аналіз причин, сповіщення.
const { Router, Telemetry, EventLog, Settings } = require('../models');
const { AdapterFactory } = require('../adapters');
const { LatencyAnomalyDetector } = require('../ml/anomaly');
const { buildFeatures, inBlackoutSchedule } = require('../ml/features');
const { analyzeOutage } = require('./analyzer');

const HISTORY_MS = 60 * 60 * 1000;     // скільки історії затримок тримати в пам'яті (1 год)
const BEFORE_MS = 2 * 60 * 1000;       // вікно «перед збоєм» (2 хв)
const PEER_WINDOW_MS = 2 * 60 * 1000;  // одночасними вважаємо збої з різницею старту до 2 хв
const DEGRADATION_COOLDOWN_MS = 10 * 60 * 1000;
const CONFIRM_FAILS = 2;               // скільки невдалих перевірок поспіль означає аварію

class Monitor {
  constructor({ notifier, adapterFactory = AdapterFactory, now = () => Date.now(), log = console } = {}) {
    Object.assign(this, { notifier, adapterFactory, now, log });
    this.detector = new LatencyAnomalyDetector();
    this.outages = new Map();     // routerId -> {startedAt}
    this.recentStarts = [];       // [{routerId, area, isp, startedAt}] — для пошуку «сусідів»
    this.history = new Map();     // routerId -> [{t, latency|null}]
    this.live = new Map();        // routerId -> остання телеметрія (для фронтенду)
    this.lastDegradation = new Map();
    this.pending = new Map();     // routerId -> {since, fails} — ще не підтверджені втрати зв'язку
  }

  remember(routerId, latency) {
    const key = String(routerId); const t = this.now();
    const h = this.history.get(key) || [];
    h.push({ t, latency });
    while (h.length && h[0].t < t - HISTORY_MS) h.shift();
    this.history.set(key, h);
  }

  peerRatio(router, startedAt, field, routers) {
    const peers = routers.filter(r => String(r._id) !== String(router._id) && router[field] && r[field] === router[field]);
    if (!peers.length) return 0;
    const down = new Set(this.recentStarts
      .filter(s => s[field] === router[field] && String(s.routerId) !== String(router._id)
        && Math.abs(s.startedAt - startedAt) <= PEER_WINDOW_MS)
      .map(s => String(s.routerId)));
    return down.size / peers.length;
  }

  async featuresFor(router, startedAt, endedAt, routers) {
    const h = this.history.get(String(router._id)) || [];
    const before = h.filter(p => p.t >= startedAt - BEFORE_MS && p.t < startedAt);
    const baseline = h.filter(p => p.t < startedAt - BEFORE_MS && p.latency !== null).map(p => p.latency);
    const schedule = (await Settings.findOne({ key: 'blackoutSchedule' }))?.value || [];
    return buildFeatures({
      downtimeSec: (endedAt - startedAt) / 1000,
      startedAt: new Date(startedAt),
      latencyBefore: before.filter(p => p.latency !== null).map(p => p.latency),
      latencyBaseline: baseline,
      failedProbes: before.filter(p => p.latency === null).length,
      totalProbes: before.length,
      peersAreaDown: this.peerRatio(router, startedAt, 'area', routers),
      peersIspDown: this.peerRatio(router, startedAt, 'isp', routers),
      scheduled: inBlackoutSchedule(new Date(startedAt), router.area, schedule),
    });
  }

  async pollRouter(router, routers) {
    const id = String(router._id);
    try {
      const data = await this.adapterFactory.create(router).getTelemetry();
      const a = this.detector.update(id, data.pingLatency);
      this.live.set(id, { ...data, anomaly: a.anomaly, z: a.z, degraded: a.degraded });
      this.remember(id, data.pingLatency);
      this.pending.delete(id);          // поодинока втрачена перевірка — не аварія, лише втрата в статистиці (BUG-10)

      if (this.outages.has(id)) {                       // зв'язок відновився — аналізуємо інцидент
        const { startedAt } = this.outages.get(id);
        const endedAt = this.now();
        const downtimeSec = Math.round((endedAt - startedAt) / 1000);
        const features = await this.featuresFor(router, startedAt, endedAt, routers);
        const verdict = analyzeOutage({ downtimeSec, uptimeSec: data.uptime, features });
        await EventLog.create({
          routerId: router._id, routerName: router.name, startedAt, endedAt, timestamp: endedAt,
          downtimeSeconds: downtimeSec, ...verdict, features,
        });
        this.outages.delete(id);
        this.notifier?.postMortem(router, verdict, downtimeSec);
      } else if (a.degraded && this.now() - (this.lastDegradation.get(id) || 0) > DEGRADATION_COOLDOWN_MS) {
        this.lastDegradation.set(id, this.now());
        await EventLog.create({ routerId: router._id, routerName: router.name, type: 'INFO', cause: 'DEGRADATION',
          method: 'detector', message: 'Деградація каналу: аномально висока затримка', confidence: null,
          explanation: 'Затримка в мережі стабільно перевищує норму. Можливе перевантаження або початок аварії провайдера.' });
        this.notifier?.degradation(router, a.z);
      }

      router.status = 'ONLINE';
      router.lastSeen = new Date(this.now());
      await router.save();
      await Telemetry.create({ routerId: router._id, pingLatency: data.pingLatency, cpuLoad: data.cpuLoad,
        freeMemory: data.freeMemory, uptime: data.uptime, anomaly: a.anomaly, z: a.z });
    } catch (err) {
      if (!/OFFLINE/.test(err.message)) this.log.error?.('Помилка опитування', id, err.message);
      this.remember(id, null);
      this.live.delete(id);
      if (this.outages.has(id)) return;
      // Аварію підтверджуємо лише після CONFIRM_FAILS невдалих перевірок поспіль (≤ 10 с при опитуванні раз на 5 с),
      // але відлік тривалості ведемо від першої невдалої перевірки.
      const p = this.pending.get(id) || { since: this.now(), fails: 0 };
      p.fails += 1;
      this.pending.set(id, p);
      if (p.fails < CONFIRM_FAILS) return;
      this.pending.delete(id);
      const startedAt = p.since;
      this.outages.set(id, { startedAt });
      this.recentStarts.push({ routerId: id, area: router.area, isp: router.isp, startedAt });
      this.recentStarts = this.recentStarts.filter(s => s.startedAt > startedAt - 24 * 3600 * 1000);
      // після перезапуску сервера роутер може вже бути OFFLINE у БД — тоді тривогу не дублюємо
      if (router.status !== 'OFFLINE') {
        router.status = 'OFFLINE';
        await router.save();
        this.notifier?.alert(router);
      }
    }
  }

  async tick() {
    const routers = await Router.find();
    await Promise.all(routers.map(r => this.pollRouter(r, routers)));
  }

  start(intervalMs = 5000) {
    this.timer = setInterval(() => this.tick().catch(e => this.log.error?.('tick', e.message)), intervalMs);
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { Monitor };
