require('dotenv').config();
const mongoose = require('mongoose');
const { Router } = require('./src/models');
const { createApp } = require('./src/app');
const { Monitor } = require('./src/services/monitor');
const { TelegramNotifier } = require('./src/services/notifier');

const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/soho_monitor',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  pollMs: Number(process.env.POLL_INTERVAL_MS) || 5000,
  heartbeatMs: Number(process.env.HEARTBEAT_MS) || 30000,
};

const notifier = new TelegramNotifier({ token: process.env.TELEGRAM_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
const monitor = new Monitor({ notifier });
const app = createApp({ monitor, notifier, config });

// Регулярний звіт у Telegram (heartbeat)
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
    } catch (e) { console.error('heartbeat', e.message); }
    scheduleHeartbeat();
  }, config.heartbeatMs);
}

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
  monitor.start(config.pollMs);
  scheduleHeartbeat();
  app.listen(config.port, () => console.log(`Сервер працює на порту ${config.port}`));
}

main().catch(err => { console.error('Помилка запуску:', err.message); process.exit(1); });
