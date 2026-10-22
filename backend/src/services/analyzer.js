// Сервіс аналізу інцидентів — єдине джерело вердикту для журналу, API і Telegram.
// 1) Якщо доступний лічильник uptime (UPnP) — детерміноване правило з дипломної роботи:
//    uptime + T_boot < downtime  =>  роутер перезавантажувався  =>  знеструмлення.
// 2) Якщо uptime недоступний — ML-класифікатор за непрямими ознаками.
const classifier = require('../ml/classifier');
const { explain } = require('./explainer');

const T_BOOT = 60;               // апаратна константа часу завантаження роутера, с
const DEVICE_FAULT_MAX = 300;    // перезавантаження без зникнення живлення в зоні — збій пристрою, якщо коротке

const TYPE_BY_CAUSE = { POWER_OUTAGE: 'CRITICAL', ISP_OUTAGE: 'WARNING', DEVICE_FAULT: 'WARNING', DEGRADATION: 'INFO', UNKNOWN: 'WARNING' };
const MESSAGE_BY_CAUSE = {
  POWER_OUTAGE: 'Зафіксовано втрату електроживлення (Power Outage)',
  ISP_OUTAGE: 'Аварія інтернет-провайдера (ISP Outage)',
  DEVICE_FAULT: 'Збій або перезавантаження маршрутизатора (Device Fault)',
  UNKNOWN: 'Причину не визначено — потрібне підтвердження оператора',
};

/**
 * @param {object} p
 * @param {number} p.downtimeSec
 * @param {number|null} p.uptimeSec     — uptime після відновлення або null
 * @param {object} [p.features]         — ознаки для ML (обов'язкові, якщо uptime недоступний)
 * @returns {{cause, type, message, method, confidence, probabilities, explanation}}
 */
function analyzeOutage({ downtimeSec, uptimeSec, features }) {
  let cause, method, confidence, probabilities;
  if (typeof uptimeSec === 'number') {
    method = 'rule';
    confidence = 1;
    const rebooted = uptimeSec + T_BOOT < downtimeSec;
    if (!rebooted) cause = 'ISP_OUTAGE';
    else if (downtimeSec <= DEVICE_FAULT_MAX && features && features.peers_area_down < 0.2) cause = 'DEVICE_FAULT';
    else cause = 'POWER_OUTAGE';
  } else {
    if (!features) throw new Error('Для ML-аналізу потрібні ознаки інциденту');
    method = 'ml';
    const r = classifier.predict(features);
    cause = r.label; confidence = r.confidence; probabilities = r.probabilities;
  }
  return {
    cause, method, confidence, probabilities,
    type: TYPE_BY_CAUSE[cause],
    message: MESSAGE_BY_CAUSE[cause],
    explanation: explain({ cause, downtimeSec, method, confidence, features }),
  };
}

module.exports = { analyzeOutage, T_BOOT, MESSAGE_BY_CAUSE };
