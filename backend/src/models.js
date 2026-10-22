const mongoose = require('mongoose');

const RouterSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  ip: { type: String, required: true, trim: true },
  type: { type: String, enum: ['SNMP', 'MIKROTIK', 'UPNP', 'SIM'], default: 'UPNP' },
  isp: { type: String, default: '', maxlength: 60 },        // провайдер — для пошуку «сусідів» при аварії
  area: { type: String, default: '', maxlength: 60 },       // зона/черга електропостачання
  upnpControlUrl: { type: String, default: '' },            // URL сервісу WANIPConnection (якщо UPnP увімкнено)
  credentials: {
    community: { type: String, default: 'public' },
    username: String,
    password: String,
  },
  status: { type: String, enum: ['UNKNOWN', 'ONLINE', 'OFFLINE'], default: 'UNKNOWN' },
  lastSeen: Date,
}, { timestamps: true });

const TelemetrySchema = new mongoose.Schema({
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', index: true },
  timestamp: { type: Date, default: Date.now },
  pingLatency: Number,
  cpuLoad: Number,
  freeMemory: Number,
  uptime: Number,
  anomaly: { type: Boolean, default: false },
  z: Number,
});
// Телеметрію зберігаємо 7 днів — далі MongoDB видаляє її автоматично (TTL-індекс)
TelemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

const EventLogSchema = new mongoose.Schema({
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', index: true },
  routerName: String,
  timestamp: { type: Date, default: Date.now },   // момент фіксації події (= відновлення зв'язку)
  startedAt: Date,
  endedAt: Date,
  type: { type: String, enum: ['CRITICAL', 'WARNING', 'INFO'] },
  cause: { type: String, enum: ['POWER_OUTAGE', 'ISP_OUTAGE', 'DEVICE_FAULT', 'DEGRADATION', 'UNKNOWN'] },
  message: String,
  downtimeSeconds: Number,
  method: { type: String, enum: ['rule', 'ml', 'detector'] },   // хто виніс вердикт
  confidence: Number,
  probabilities: Object,
  features: Object,
  explanation: String,
  confirmedCause: String,   // підтверджена оператором причина (для перенавчання)
});

const SettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: Object,
});

module.exports = {
  Router: mongoose.model('Router', RouterSchema),
  Telemetry: mongoose.model('Telemetry', TelemetrySchema),
  EventLog: mongoose.model('EventLog', EventLogSchema),
  Settings: mongoose.model('Settings', SettingsSchema),
};
