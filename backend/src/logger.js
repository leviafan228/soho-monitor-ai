// Структуроване журналювання (JSON-рядки) з маскуванням секретів.
const fs = require('fs');
const path = require('path');

const SECRET_KEYS = /pass(word)?|token|secret|authorization|apikey/i;
const TG_TOKEN = /\d{8,10}:[A-Za-z0-9_-]{30,}/g;

function mask(value) {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '***' : mask(v)]));
  }
  return typeof value === 'string' ? value.replace(TG_TOKEN, '***telegram-token***') : value;
}

function createLogger({ dir = process.env.LOG_DIR, silent = false } = {}) {
  let stream = null;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    stream = fs.createWriteStream(path.join(dir, 'app.log'), { flags: 'a' });
  }
  const write = (level, msg, data) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: mask(msg), ...(data ? { data: mask(data) } : {}) });
    if (!silent) (level === 'error' ? console.error : console.log)(line);
    if (stream) stream.write(line + '\n');
  };
  return {
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
  };
}

module.exports = { createLogger, mask };
