require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const { Router, Telemetry, EventLog } = require('./src/models');
const AdapterFactory = require('./src/adapters');
const { AnalyzerService } = require('./src/services');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const downtimeCache = {};
const liveDataCache = {}; // Кеш для передачі метрик на фронтенд без зміни Бази Даних

// --- НАЛАШТУВАННЯ ТЕЛЕГРАМ ---
let tgConfig = {
  token: process.env.TELEGRAM_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  interval: 30000 // За замовчуванням 30 сек
};

// Збереження налаштувань із фронтенду
app.post('/api/settings/telegram', (req, res) => {
  const { chatId, interval } = req.body;
  if (chatId) tgConfig.chatId = chatId;
  if (interval) tgConfig.interval = parseInt(interval) * 1000;
  
  // Перезапускаємо таймер з новим інтервалом
  startTgHeartbeat();
  res.json({ success: true });
});

// Функція: Повідомлення про УСУНЕННЯ аварії
async function sendTelegramPostMortem(routerName, ip, errorMessage, durationMs) {
  const m = Math.floor(durationMs / 60000);
  const s = Math.floor((durationMs % 60000) / 1000);
  const durationText = `${m > 0 ? `${m} хв ` : ''}${s} сек`;

  const text = `✅ <b>ЗВ'ЯЗОК ВІДНОВЛЕНО</b>\n\n🌐 <b>Вузол:</b> ${routerName} (${ip})\n🛠 <b>Помилку усунено:</b> ${errorMessage}\n⏱ <b>Тривалість простою:</b> ${durationText}`;
  try {
    await axios.post(`https://api.telegram.org/bot${tgConfig.token}/sendMessage`, {
      chat_id: tgConfig.chatId,
      text: text,
      parse_mode: 'HTML'
    });
  } catch (err) { console.error('Помилка Post-Mortem:', err.message); }
}

// Постійне опитування роутерів
setInterval(async () => {
  const routers = await Router.find();
  for (const router of routers) {
    try {
      const adapter = AdapterFactory.create(router.type, router.ip, router.credentials);
      const data = await adapter.getTelemetry();
      liveDataCache[router._id] = data; // Зберігаємо для фронтенду і Telegram
      
      // Якщо роутер піднявся - аналізуємо і відправляємо звіт про усунення
      if (router.status === 'OFFLINE' && downtimeCache[router._id]) {
        const downtime = Date.now() - downtimeCache[router._id];
        // AnalyzerService створює подію в базі. Ми імітуємо повідомлення:
        const msg = downtime > 65000 ? 'Втрата електроживлення (Блекаут)' : 'Аварія інтернет-провайдера';
        
        await AnalyzerService.analyzeOutage(router, downtimeCache[router._id], Date.now());
        
        sendTelegramPostMortem(router.name, router.ip, msg, downtime);
        delete downtimeCache[router._id];
      }

      router.status = 'ONLINE';
      router.lastSeen = Date.now();
      await router.save();

      await Telemetry.create({
        routerId: router._id,
        cpuLoad: data.cpuLoad,
        freeMemory: data.freeMemory,
        uptime: data.uptime
      });

    } catch (error) {
      if (router.status === 'ONLINE') {
        router.status = 'OFFLINE';
        downtimeCache[router._id] = Date.now();
        await router.save();
      }
    }
  }
}, 5000);

// API Маршрути
app.get('/api/routers', async (req, res) => {
  const routers = await Router.find();
  // Додаємо живі дані до роутерів, щоб фронтенд бачив швидкість і пінг
  const result = routers.map(r => ({
    ...r.toObject(),
    liveData: liveDataCache[r._id] || {}
  }));
  res.json(result);
});

app.post('/api/routers', async (req, res) => res.json(await Router.create(req.body)));
app.get('/api/telemetry/:id', async (req, res) => {
  const data = await Telemetry.find({ routerId: req.params.id }).sort({ timestamp: -1 }).limit(20);
  res.json(data.reverse());
});
app.get('/api/events', async (req, res) => {
  const events = await EventLog.find().sort({ timestamp: -1 }).limit(10);
  res.json(events);
});
app.delete('/api/routers/:id', async (req, res) => {
  await Router.findByIdAndDelete(req.params.id);
  await Telemetry.deleteMany({ routerId: req.params.id }); 
  res.json({ success: true });
});

// --- TELEGRAM HEARTBEAT ---
let tgTimer;
function startTgHeartbeat() {
  if (tgTimer) clearInterval(tgTimer);
  tgTimer = setInterval(async () => {
    try {
      const routers = await Router.find();
      if (routers.length === 0) return;

      let message = `⏱ <b>Регулярний звіт</b>\nЧас: ${new Date().toLocaleTimeString('uk-UA')}\n\n`;

      for (const router of routers) {
        const live = liveDataCache[router._id] || {};
        if (router.status === 'ONLINE') {
          message += `🟢 <b>${router.name}</b> (${router.ip})\n`;
          message += `📥 Завантаження: <b>${live.downloadSpeed || 0} Мб/с</b>\n`;
          message += `📤 Віддача: <b>${live.uploadSpeed || 0} Мб/с</b>\n`;
          message += `⚡ Затримка: <b>${live.pingLatency || 0} мс</b>\n\n`;
        } else {
          message += `🔴 <b>${router.name}</b> (${router.ip})\n❌ СТАТУС: ВІДСУТНІЙ ЗВ'ЯЗОК\n\n`;
        }
      }

      await axios.post(`https://api.telegram.org/bot${tgConfig.token}/sendMessage`, {
        chat_id: tgConfig.chatId,
        text: message,
        parse_mode: 'HTML',
        disable_notification: true
      });
    } catch (err) { console.error('Telegram Error'); }
  }, tgConfig.interval);
}

startTgHeartbeat();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));