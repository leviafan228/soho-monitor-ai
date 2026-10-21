// Перевірка вхідних даних API. Повертає масив помилок (порожній — дані коректні).
const mongoose = require('mongoose');

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const TYPES = ['SNMP', 'MIKROTIK', 'UPNP', 'SIM'];
const SAFE_TEXT = /^[^<>{}$]*$/;   // без символів, що використовуються в XSS та NoSQL-ін'єкціях

function validateRouter(body = {}) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
  if (name.length < 2 || name.length > 60) errors.push('Назва: від 2 до 60 символів');
  else if (!SAFE_TEXT.test(name)) errors.push('Назва містить недопустимі символи');
  if (!IPV4.test(ip) && !(HOSTNAME.test(ip) && /[a-z]/i.test(ip))) errors.push('IP-адреса або доменне ім\'я некоректні');
  if (body.type !== undefined && !TYPES.includes(body.type)) errors.push(`Тип має бути одним з: ${TYPES.join(', ')}`);
  for (const f of ['isp', 'area']) {
    if (body[f] !== undefined && (typeof body[f] !== 'string' || body[f].length > 60 || !SAFE_TEXT.test(body[f]))) {
      errors.push(`Поле ${f}: рядок до 60 символів без спецсимволів`);
    }
  }
  if (body.upnpControlUrl && !/^(https?|sim):\/\/[^\s]+$/.test(body.upnpControlUrl)) errors.push('upnpControlUrl має бути http(s)-адресою');
  return errors;
}

function validateTelegramSettings(body = {}) {
  const errors = [];
  if (body.chatId !== undefined && !/^-?\d{5,15}$/.test(String(body.chatId))) errors.push('Chat ID — ціле число (5–15 цифр)');
  if (body.interval !== undefined && ![10, 30, 60, 300].includes(Number(body.interval))) errors.push('Інтервал: 10, 30, 60 або 300 секунд');
  return errors;
}

const isObjectId = id => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;

module.exports = { validateRouter, validateTelegramSettings, isObjectId, IPV4 };
