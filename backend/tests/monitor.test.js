// Інтеграційний тест: монітор + MongoDB (тестова БД). Пропускається, якщо MongoDB недоступна.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Router, EventLog, Telemetry } = require('../src/models');
const { Monitor } = require('../src/services/monitor');

const URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/soho_monitor_test';
let available = true;

test.before(async () => {
  try { await mongoose.connect(URI, { serverSelectionTimeoutMS: 2000 }); await mongoose.connection.dropDatabase(); }
  catch { available = false; }
});
test.after(async () => { if (available) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } });

// Керований «роутер»: script — що повертати на кожному кроці
function fakeFactory(state) {
  return { create: () => ({ getTelemetry: async () => {
    if (state.offline) throw new Error('OFFLINE');
    return { pingLatency: state.latency ?? 20, uptime: state.uptime, cpuLoad: 10, freeMemory: 100 };
  } }) };
}

test('повний цикл: втрата зв\'язку -> відновлення -> подія з вердиктом і сповіщення', async t => {
  if (!available) return t.skip('MongoDB недоступна');
  let now = Date.parse('2026-10-20T10:00:00');
  const state = { offline: false, uptime: 7200 };
  const sent = [];
  const notifier = { alert: r => sent.push(['alert', r.name]), postMortem: (r, v) => sent.push(['pm', v.cause]), degradation: () => {} };
  const monitor = new Monitor({ notifier, adapterFactory: fakeFactory(state), now: () => now, log: { error() {} } });
  await Router.create({ name: 'Кав\'ярня', ip: '10.0.0.1', type: 'UPNP', area: 'Черга 2', isp: 'Volia' });

  for (let i = 0; i < 5; i++) { await monitor.tick(); now += 5000; }
  assert.equal((await Router.findOne()).status, 'ONLINE');

  state.offline = true;
  await monitor.tick(); now += 5000;                    // перша невдала перевірка — ще не аварія
  assert.equal((await Router.findOne()).status, 'ONLINE');
  await monitor.tick(); now += 30 * 60 * 1000 - 5000;   // друга поспіль — аварія підтверджена; разом 30 хв
  assert.equal((await Router.findOne()).status, 'OFFLINE');

  state.offline = false; state.uptime = 7200 + 1800;    // uptime не скидався => провайдер
  await monitor.tick();
  const ev = await EventLog.findOne();
  assert.equal(ev.cause, 'ISP_OUTAGE');
  assert.equal(ev.method, 'rule');
  assert.equal(ev.downtimeSeconds, 1800);
  assert.deepEqual(sent.map(s => s[0]), ['alert', 'pm']);
  assert.equal(sent[1][1], 'ISP_OUTAGE');                 // у Telegram той самий вердикт, що й у журналі
  assert.ok(await Telemetry.countDocuments() >= 6);
});

test('роутер без UPnP: вердикт виносить ML-класифікатор', async t => {
  if (!available) return t.skip('MongoDB недоступна');
  await mongoose.connection.dropDatabase();
  let now = Date.parse('2026-10-20T16:00:00');
  const state = { offline: false, uptime: null };
  const monitor = new Monitor({ notifier: null, adapterFactory: fakeFactory(state), now: () => now, log: { error() {} } });
  await Router.create({ name: 'Салон', ip: '10.0.0.2', type: 'SNMP' });
  for (let i = 0; i < 3; i++) { await monitor.tick(); now += 5000; }
  state.offline = true; await monitor.tick(); now += 5000; await monitor.tick(); now += 3 * 3600 * 1000 - 5000;
  state.offline = false; await monitor.tick();
  const ev = await EventLog.findOne();
  assert.equal(ev.method, 'ml');
  assert.ok(ev.features && typeof ev.features.log_downtime === 'number');
});

test('BUG-10: поодинока втрачена перевірка не створює інцидент (захист від флапінгу)', async t => {
  if (!available) return t.skip('MongoDB недоступна');
  await mongoose.connection.dropDatabase();
  let now = Date.parse('2026-10-20T12:00:00');
  const state = { offline: false, uptime: 5000 };
  const sent = [];
  const notifier = { alert: () => sent.push('alert'), postMortem: () => sent.push('pm'), degradation: () => {} };
  const monitor = new Monitor({ notifier, adapterFactory: fakeFactory(state), now: () => now, log: { error() {} } });
  await Router.create({ name: 'Магазин', ip: '10.0.0.3', type: 'UPNP' });
  for (let i = 0; i < 3; i++) { await monitor.tick(); now += 5000; }
  for (let i = 0; i < 4; i++) {                          // чотири поодинокі втрати, розділені успішними перевірками
    state.offline = true; await monitor.tick(); now += 5000;
    state.offline = false; await monitor.tick(); now += 5000;
  }
  assert.equal(await EventLog.countDocuments(), 0);
  assert.deepEqual(sent, []);
  assert.equal((await Router.findOne()).status, 'ONLINE');
});
