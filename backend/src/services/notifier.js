// Надсилання сповіщень у Telegram. Без токена працює в «тихому» режимі (лише лог).
const axios = require('axios');
const { formatDuration } = require('./explainer');

class TelegramNotifier {
  constructor({ token = '', chatId = '', http = axios, log = console } = {}) {
    Object.assign(this, { token, chatId, http, log });
  }

  get enabled() { return Boolean(this.token && this.chatId); }

  async send(text, silent = false) {
    if (!this.enabled) { this.log.info?.('[telegram:disabled]', text.replace(/<[^>]+>/g, '')); return false; }
    try {
      await this.http.post(`https://api.telegram.org/bot${this.token}/sendMessage`,
        { chat_id: this.chatId, text, parse_mode: 'HTML', disable_notification: silent });
      return true;
    } catch (err) {
      this.log.error?.('Telegram: помилка надсилання', err.message);
      return false;
    }
  }

  // Фаза 1 — миттєва тривога
  alert(router) {
    return this.send(`🔴 <b>ВТРАЧЕНО ЗВ'ЯЗОК</b>\n\n🌐 <b>Вузол:</b> ${router.name} (${router.ip})\n⏳ Аналізую причину…`);
  }

  // Фаза 2 — звіт після відновлення (вердикт той самий, що й у журналі)
  postMortem(router, verdict, downtimeSec) {
    const conf = verdict.method === 'ml' ? ` (ML, ${Math.round(verdict.confidence * 100)}%)` : ' (за uptime)';
    return this.send(`✅ <b>ЗВ'ЯЗОК ВІДНОВЛЕНО</b>\n\n🌐 <b>Вузол:</b> ${router.name} (${router.ip})\n`
      + `🛠 <b>Причина:</b> ${verdict.message}${conf}\n⏱ <b>Тривалість простою:</b> ${formatDuration(downtimeSec)}\n\n💡 ${verdict.explanation}`);
  }

  degradation(router, z) {
    return this.send(`🟡 <b>ДЕГРАДАЦІЯ КАНАЛУ</b>\n\n🌐 ${router.name} (${router.ip})\nЗатримка аномально висока (z = ${z}). Можлива аварія провайдера.`);
  }
}

module.exports = { TelegramNotifier };
