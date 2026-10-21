// Express-застосунок (окремо від server.js, щоб його можна було тестувати без запуску опитування).
const express = require('express');
const cors = require('cors');
const { Router, Telemetry, EventLog, Settings } = require('./models');
const { SimulatedAdapter } = require('./adapters');
const classifier = require('./ml/classifier');

function createApp({ monitor, notifier, config = {} } = {}) {
  const app = express();
  app.use(cors({ origin: config.corsOrigin || 'http://localhost:3000' }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  app.get('/api/routers', async (req, res) => {
    const routers = await Router.find().select('-credentials');
    res.json(routers.map(r => ({ ...r.toObject(), liveData: monitor?.live.get(String(r._id)) || {} })));
  });

  app.post('/api/routers', async (req, res) => {
    const { name, ip, type, isp, area, upnpControlUrl } = req.body;
    res.status(201).json(await Router.create({ name, ip, type, isp, area, upnpControlUrl }));
  });

  app.delete('/api/routers/:id', async (req, res) => {
    await Router.findByIdAndDelete(req.params.id);
    await Telemetry.deleteMany({ routerId: req.params.id });
    res.json({ success: true });
  });

  app.get('/api/telemetry/:id', async (req, res) => {
    const data = await Telemetry.find({ routerId: req.params.id }).sort({ timestamp: -1 }).limit(30);
    res.json(data.reverse());
  });

  app.get('/api/events', async (req, res) => {
    res.json(await EventLog.find().sort({ timestamp: -1 }).limit(20));
  });

  app.get('/api/ml/info', (req, res) => {
    const { features, classes, metrics, version, confidence_threshold } = classifier.model;
    res.json({ version, features, classes, metrics, confidence_threshold });
  });

  app.post('/api/settings/telegram', (req, res) => {
    const { chatId, interval } = req.body;
    if (chatId) notifier.chatId = String(chatId);
    if (interval) config.heartbeatMs = parseInt(interval, 10) * 1000;
    res.json({ success: true });
  });

  app.put('/api/settings/blackout-schedule', async (req, res) => {
    await Settings.findOneAndUpdate({ key: 'blackoutSchedule' }, { value: req.body.schedule || [] }, { upsert: true });
    res.json({ success: true });
  });

  // Запуск сценарію збою для симульованого роутера (демонстрація ІІС без реального обладнання)
  app.post('/api/sim/:id/scenario', async (req, res) => {
    const { kind, durationSec = 90 } = req.body;
    SimulatedAdapter.startScenario(req.params.id, kind, Number(durationSec));
    res.json({ success: true });
  });

  return app;
}

module.exports = { createApp };
