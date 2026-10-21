const mongoose = require('mongoose');

const RouterSchema = new mongoose.Schema({
  name: String,
  ip: String,
  type: { type: String, enum: ['SNMP', 'MIKROTIK'] },
  credentials: {
    community: { type: String, default: 'public' },
    username: String,
    password: String
  },
  status: { type: String, default: 'ONLINE' },
  lastSeen: Date
});

const TelemetrySchema = new mongoose.Schema({
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router' },
  timestamp: { type: Date, default: Date.now },
  cpuLoad: Number,
  freeMemory: Number,
  uptime: Number
});

const EventLogSchema = new mongoose.Schema({
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router' },
  timestamp: { type: Date, default: Date.now },
  type: String, // 'WARNING' або 'CRITICAL'
  message: String,
  downtimeSeconds: Number
});

module.exports = {
  Router: mongoose.model('Router', RouterSchema),
  Telemetry: mongoose.model('Telemetry', TelemetrySchema),
  EventLog: mongoose.model('EventLog', EventLogSchema)
};