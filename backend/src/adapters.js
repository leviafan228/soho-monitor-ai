const net = require('net');
const os = require('os');
const axios = require('axios');

// Патерн Adapter: кожен тип пристрою має однаковий інтерфейс getTelemetry().
// uptime === null означає, що лічильник роботи роутера недоступний (UPnP вимкнено) —
// у такому разі причину збою визначає ML-класифікатор за непрямими ознаками.

class RealSohoAdapter {
  constructor(ip, { upnpControlUrl } = {}) {
    this.ip = ip;
    this.upnpControlUrl = upnpControlUrl;
  }

  // Вимірювання затримки встановленням TCP-з'єднання з портом 80 (ICMP потребує прав адміністратора)
  async measureLatency(timeoutMs = 2000) {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve(Date.now() - startTime); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('OFFLINE')); });
      socket.on('error', () => { socket.destroy(); reject(new Error('OFFLINE')); });
      socket.connect(80, this.ip);
    });
  }

  // UPnP IGD: SOAP-запит GetStatusInfo повертає NewUptime — час роботи WAN-з'єднання роутера, с
  async readUptime() {
    if (!this.upnpControlUrl) return null;
    const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
      + 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
      + '<u:GetStatusInfo xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1"/></s:Body></s:Envelope>';
    try {
      const res = await axios.post(this.upnpControlUrl, body, {
        timeout: 2000,
        headers: { 'Content-Type': 'text/xml; charset="utf-8"',
          SOAPAction: '"urn:schemas-upnp-org:service:WANIPConnection:1#GetStatusInfo"' },
      });
      const m = /<NewUptime>(\d+)<\/NewUptime>/.exec(res.data);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  }

  async getTelemetry() {
    const pingLatency = await this.measureLatency();
    const uptime = await this.readUptime();
    // Навантаження та пам'ять сервера моніторингу (роутер ці дані не віддає без SNMP)
    const cpuLoad = Math.min(100, Math.round((os.loadavg()[0] / os.cpus().length) * 100));
    const freeMemory = Math.floor(os.freemem() / (1024 * 1024));
    return { uptime, pingLatency, cpuLoad, freeMemory };
  }
}

// Симулятор маршрутизатора для демонстрації та тестування сценаріїв збою без реального обладнання.
class SimulatedAdapter {
  static devices = new Map();

  constructor(id, { now = () => Date.now(), random = Math.random, upnp = true } = {}) {
    this.id = String(id);
    this.upnp = upnp;
    this.now = now;
    this.random = random;
    if (!SimulatedAdapter.devices.has(this.id)) {
      SimulatedAdapter.devices.set(this.id, { bootAt: now() - 3600 * 1000, baseLatency: 15 + random() * 15, scenario: null });
    }
  }

  get dev() { return SimulatedAdapter.devices.get(this.id); }

  /** Запускає сценарій: 'POWER_OUTAGE' | 'ISP_OUTAGE' | 'DEVICE_FAULT' | 'DEGRADATION'. */
  static startScenario(id, kind, durationSec) {
    const d = SimulatedAdapter.devices.get(String(id));
    if (!d) throw new Error('Невідомий симульований пристрій');
    const now = Date.now();
    const warmup = kind === 'ISP_OUTAGE' ? 60 : 0;    // аварія провайдера: спершу хвилина деградації
    d.scenario = { kind, degradeFrom: now, downFrom: now + warmup * 1000, downTo: now + (warmup + durationSec) * 1000 };
  }

  async getTelemetry() {
    const d = this.dev; const t = this.now(); const s = d.scenario;
    let latency = d.baseLatency + (this.random() - 0.5) * 4;
    if (s) {
      if (t >= s.downFrom && t < s.downTo && s.kind !== 'DEGRADATION') throw new Error('OFFLINE');
      if (t >= s.downTo) {
        if (s.kind === 'POWER_OUTAGE' || s.kind === 'DEVICE_FAULT') d.bootAt = s.downTo;  // роутер перезавантажився
        d.scenario = null;
      } else if (s.kind === 'ISP_OUTAGE' || s.kind === 'DEGRADATION') {
        latency = d.baseLatency * (2.5 + this.random() * 2) + this.random() * 40;
        if (s.kind === 'ISP_OUTAGE' && this.random() < 0.25) throw new Error('OFFLINE');  // втрати пакетів перед аварією
      }
    }
    return {
      uptime: this.upnp ? Math.floor((t - d.bootAt) / 1000) : null,   // без UPnP лічильник недоступний
      pingLatency: Math.round(latency),
      cpuLoad: Math.round(20 + this.random() * 15),
      freeMemory: 512 - Math.round(this.random() * 50),
    };
  }
}

class AdapterFactory {
  static create(router) {
    if (router.type === 'SIM') return new SimulatedAdapter(router._id, { upnp: Boolean(router.upnpControlUrl) });
    return new RealSohoAdapter(router.ip, { upnpControlUrl: router.upnpControlUrl });
  }
}

module.exports = { AdapterFactory, RealSohoAdapter, SimulatedAdapter };
