require('dotenv').config();
const mongoose = require('mongoose');
const { Router, User } = require('./src/models');
const { createApp } = require('./src/app');
const { Monitor } = require('./src/services/monitor');
const { TelegramNotifier } = require('./src/services/notifier');
const { createLogger } = require('./src/logger');
const { hashPassword, passwordProblems } = require('./src/auth');

const log = createLogger();
const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/soho_monitor',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  pollMs: Number(process.env.POLL_INTERVAL_MS) || 5000,
  heartbeatMs: Number(process.env.HEARTBEAT_MS) || 30000,
  jwtSecret: process.env.JWT_SECRET,
};

const notifier = new TelegramNotifier({ token: process.env.TELEGRAM_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, log });
const monitor = new Monitor({ notifier, log });

// Перший адміністратор створюється з .env, якщо в БД ще немає жодного користувача
async function ensureAdmin() {
  if (await User.countDocuments()) return;
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) { log.warn('Немає користувачів: задайте ADMIN_EMAIL і ADMIN_PASSWORD у .env'); return; }
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`ADMIN_PASSWORD занадто слабкий: ${problems.join(', ')}`);
  await User.create({ email, name: 'Адміністратор', role: 'admin', passwordHash: hashPassword(password) });
  log.info('Створено обліковий запис адміністратора', { email });
}

function scheduleHeartbeat() {
  setTimeout(async () => {
    try {
      const routers = await Router.find();
      if (routers.length) {
        let msg = `⏱ <b>Регулярний звіт</b>\nЧас: ${new Date().toLocaleTimeString('uk-UA')}\n\n`;
        for (const r of routers) {
          const live = monitor.live.get(String(r._id));
          msg += r.status === 'ONLINE' && live
            ? `🟢 <b>${r.name}</b> (${r.ip}) — затримка ${live.pingLatency} мс${live.degraded ? ' ⚠️ деградація' : ''}\n`
            : `🔴 <b>${r.name}</b> (${r.ip}) — немає зв'язку\n`;
        }
        await notifier.send(msg, true);
      }
    } catch (e) { log.error('heartbeat', { error: e.message }); }
    scheduleHeartbeat();
  }, config.heartbeatMs);
}

async function main() {
  const app = createApp({ monitor, notifier, config, log });   // перевіряє JWT_SECRET до підключення до БД
  await mongoose.connect(config.mongoUri);
  log.info('MongoDB connected');
  await ensureAdmin();
  monitor.start(config.pollMs);
  scheduleHeartbeat();
  app.listen(config.port, () => log.info(`Сервер працює на порту ${config.port}`, { telegram: notifier.enabled }));
}

main().catch(err => { log.error('Помилка запуску', { error: err.message }); process.exit(1); });
