// Формування людського пояснення інциденту та рекомендацій для власника об'єкта.

function formatDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return [h && `${h} год`, m && `${m} хв`, `${s} с`].filter(Boolean).join(' ');
}

const ADVICE = {
  POWER_OUTAGE: 'Перевірте графік відключень вашої черги. Для безперервної роботи POS-терміналів і камер підключіть роутер до ДБЖ (UPS) або павербанка з PD.',
  ISP_OUTAGE: 'Живлення об\'єкта в нормі — проблема на боці провайдера. Зверніться до підтримки провайдера та, за потреби, увімкніть резервний канал (мобільний інтернет).',
  DEVICE_FAULT: 'Роутер перезавантажився, хоча живлення в зоні не зникало. Якщо це повторюється, перевірте блок живлення, перегрів і оновіть прошивку.',
  DEGRADATION: 'Затримка в мережі суттєво зросла. Можливе перевантаження каналу або початок аварії провайдера — варто перевірити швидкість і стан лінії.',
  UNKNOWN: 'Система не впевнена в причині. Підтвердьте причину вручну в журналі — це допоможе моделі навчитися.',
};

function reasons(features = {}) {
  const r = [];
  if (features.scheduled_blackout) r.push('збій почався у вікні графіка відключень');
  if (features.peers_area_down >= 0.3) r.push(`одночасно зник зв'язок у ${Math.round(features.peers_area_down * 100)}% об'єктів вашої зони`);
  if (features.peers_isp_down >= 0.3) r.push(`одночасно недоступні ${Math.round(features.peers_isp_down * 100)}% клієнтів того ж провайдера`);
  if (features.latency_ratio >= 1.4) r.push(`перед збоєм затримка зросла в ${features.latency_ratio.toFixed(1)} раза`);
  if (features.loss_before >= 0.1) r.push(`перед збоєм втрачалося ${Math.round(features.loss_before * 100)}% перевірок`);
  return r;
}

function explain({ cause, downtimeSec, method, confidence, features }) {
  const how = method === 'rule'
    ? 'Висновок зроблено за лічильником роботи роутера (UPnP).'
    : `Висновок зроблено ML-моделлю з упевненістю ${Math.round(confidence * 100)}%.`;
  const why = reasons(features);
  return [
    `Тривалість простою: ${formatDuration(downtimeSec)}.`,
    how,
    why.length ? `Ознаки: ${why.join('; ')}.` : '',
    `Рекомендація: ${ADVICE[cause]}`,
  ].filter(Boolean).join(' ');
}

module.exports = { explain, formatDuration };
