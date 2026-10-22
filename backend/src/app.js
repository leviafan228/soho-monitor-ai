// Express-застосунок (окремо від server.js, щоб його можна було тестувати без запуску опитування).
const express = require('express');
const cors = require('cors');
const { Router, Telemetry, EventLog, Settings, User, AuditLog } = require('./models');
const { SimulatedAdapter } = require('./adapters');
const classifier = require('./ml/classifier');
const { verifyPassword, signToken, authMiddleware, requireRole, LoginLimiter } = require('./auth');
const { validateRouter, validateTelegramSettings, isObjectId } = require('./validation');

function createApp({ monitor, notifier, config = {}, log = console } = {}) {
  const app = express();
  const secret = config.jwtSecret;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET має містити щонайменше 32 символи');
  const limiter = new LoginLimiter();

  app.disable('x-powered-by');
  app.use((req, res, next) => {             // базові заголовки безпеки
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(cors({ origin: config.corsOrigin || 'http://localhost:3000' }));
  app.use(express.json({ limit: '100kb' }));

  const audit = (req, action, severity = 'low', details = {}) =>
    AuditLog.create({ action, severity, details, userEmail: req.user?.email || details.email, ip: req.ip })
      .catch(e => log.error('audit', { error: e.message }));

  // ---------- публічні маршрути ----------
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const key = `${req.ip}|${email}`;
    if (limiter.blocked(key)) {
      audit(req, 'LOGIN_BLOCKED', 'high', { email });
      return res.status(429).json({ error: 'Забагато невдалих спроб. Спробуйте через 15 хвилин' });
    }
    const user = await User.findOne({ email, active: true });
    if (!user || !verifyPassword(String(req.body?.password || ''), user.passwordHash)) {
      limiter.fail(key);
      audit(req, 'LOGIN_FAILED', 'medium', { email });
      log.warn('Невдала спроба входу', { email, ip: req.ip });
      return res.status(401).json({ error: 'Невірний email або пароль' });   // однакова відповідь — не розкриваємо, чи існує акаунт
    }
    limiter.reset(key);
    user.lastLoginAt = new Date(); await user.save();
    audit(req, 'LOGIN_SUCCESS', 'low', { email });
    res.json({ token: signToken(user, secret), user: { email: user.email, name: user.name, role: user.role } });
  });

  // ---------- захищені маршрути ----------
  const api = express.Router();
  api.use(authMiddleware(secret));
  api.param('id', (req, res, next, id) => (isObjectId(id) ? next() : res.status(404).json({ error: 'Об\'єкт не знайдено' })));

  api.get('/me', (req, res) => res.json(req.user));

  api.get('/routers', requireRole('viewer'), async (req, res) => {
    const routers = await Router.find().select('-credentials');
    res.json(routers.map(r => ({ ...r.toObject(), liveData: monitor?.live.get(String(r._id)) || {} })));
  });

  api.post('/routers', requireRole('operator'), async (req, res) => {
    const errors = validateRouter(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const { name, ip, type, isp, area, upnpControlUrl } = req.body;
    const router = await Router.create({ name: name.trim(), ip: ip.trim(), type, isp, area, upnpControlUrl });
    audit(req, 'ROUTER_CREATE', 'low', { routerId: router._id, name: router.name, ip: router.ip });
    res.status(201).json(router);
  });

  api.delete('/routers/:id', requireRole('admin'), async (req, res) => {
    const router = await Router.findByIdAndDelete(req.params.id);
    if (!router) return res.status(404).json({ error: 'Об\'єкт не знайдено' });
    await Telemetry.deleteMany({ routerId: req.params.id });
    await EventLog.deleteMany({ routerId: req.params.id });       // раніше події видаленого роутера залишалися «сиротами»
    audit(req, 'ROUTER_DELETE', 'high', { routerId: req.params.id, name: router.name, ip: router.ip });
    res.json({ success: true });
  });

  api.get('/telemetry/:id', requireRole('viewer'), async (req, res) => {
    const data = await Telemetry.find({ routerId: req.params.id }).sort({ timestamp: -1 }).limit(30);
    res.json(data.reverse());
  });

  api.get('/events', requireRole('viewer'), async (req, res) => {
    res.json(await EventLog.find().sort({ timestamp: -1 }).limit(20));
  });

  // Підтвердження причини оператором — мітка для перенавчання моделі
  api.patch('/events/:id/confirm', requireRole('operator'), async (req, res) => {
    const allowed = ['POWER_OUTAGE', 'ISP_OUTAGE', 'DEVICE_FAULT'];
    if (!allowed.includes(req.body?.cause)) return res.status(400).json({ error: `Причина має бути однією з: ${allowed.join(', ')}` });
    const ev = await EventLog.findByIdAndUpdate(req.params.id, { confirmedCause: req.body.cause }, { new: true });
    if (!ev) return res.status(404).json({ error: 'Подію не знайдено' });
    audit(req, 'EVENT_CONFIRM', 'low', { eventId: ev._id, cause: req.body.cause });
    res.json(ev);
  });

  api.get('/export/events.csv', requireRole('operator'), async (req, res) => {
    const rows = await EventLog.find().sort({ timestamp: -1 }).limit(5000);
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['routerName,startedAt,endedAt,downtimeSeconds,cause,method,confidence']
      .concat(rows.map(e => [e.routerName, e.startedAt?.toISOString(), e.endedAt?.toISOString(), e.downtimeSeconds,
        e.cause, e.method, e.confidence].map(esc).join(','))).join('\n');
    audit(req, 'EXPORT_EVENTS', 'medium', { count: rows.length });
    res.type('text/csv').attachment('events.csv').send(csv);
  });

  api.get('/ml/info', requireRole('viewer'), (req, res) => {
    const { features, classes, metrics, version, confidence_threshold } = classifier.model;
    res.json({ version, features, classes, metrics, confidence_threshold });
  });

  api.post('/settings/telegram', requireRole('admin'), (req, res) => {
    const errors = validateTelegramSettings(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const { chatId, interval } = req.body;
    if (chatId) notifier.chatId = String(chatId);
    if (interval) config.heartbeatMs = Number(interval) * 1000;
    audit(req, 'SETTINGS_CHANGE', 'medium', { chatId: chatId ? '(змінено)' : undefined, interval });
    res.json({ success: true });
  });

  api.put('/settings/blackout-schedule', requireRole('admin'), async (req, res) => {
    const schedule = Array.isArray(req.body?.schedule) ? req.body.schedule : null;
    if (!schedule || !schedule.every(w => typeof w.area === 'string' && w.from >= 0 && w.from < 24 && w.to >= 0 && w.to <= 24)) {
      return res.status(400).json({ error: 'schedule: масив {area, from, to}, години 0–24' });
    }
    await Settings.findOneAndUpdate({ key: 'blackoutSchedule' }, { value: schedule }, { upsert: true });
    audit(req, 'SETTINGS_CHANGE', 'medium', { blackoutSchedule: schedule.length });
    res.json({ success: true });
  });

  api.get('/audit', requireRole('admin'), async (req, res) => {
    res.json(await AuditLog.find().sort({ timestamp: -1 }).limit(100));
  });

  api.get('/users', requireRole('admin'), async (req, res) => res.json(await User.find().sort({ email: 1 })));

  // Сценарії збою для симульованих роутерів (демонстрація ІІС без обладнання)
  api.post('/sim/:id/scenario', requireRole('admin'), async (req, res) => {
    const kinds = ['POWER_OUTAGE', 'ISP_OUTAGE', 'DEVICE_FAULT', 'DEGRADATION'];
    const { kind, durationSec = 90 } = req.body || {};
    if (!kinds.includes(kind)) return res.status(400).json({ error: `kind: ${kinds.join(', ')}` });
    const router = await Router.findById(req.params.id);
    if (!router || router.type !== 'SIM') return res.status(400).json({ error: 'Сценарії доступні лише для симульованих роутерів' });
    SimulatedAdapter.startScenario(router._id, kind, Math.min(Math.max(Number(durationSec) || 90, 10), 3600));
    audit(req, 'SIM_SCENARIO', 'low', { routerId: router._id, kind });
    res.json({ success: true });
  });

  app.use('/api', api);

  // Єдиний обробник помилок: деталі — у лог, клієнту — без стеку
  app.use((err, req, res, next) => {
    log.error('Необроблена помилка API', { path: req.path, error: err.message });
    res.status(err.status || 500).json({ error: err.status === 400 ? 'Некоректний запит' : 'Внутрішня помилка сервера' });
  });

  return app;
}

module.exports = { createApp };
