// Інтеграційні тести REST API: автентифікація, права доступу, валідація, аудит.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createApp } = require('../src/app');
const { User, Router, EventLog, AuditLog, Telemetry } = require('../src/models');
const { hashPassword } = require('../src/auth');

const URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/soho_monitor_api_test';
const silent = { info() {}, warn() {}, error() {} };
let server, base, available = true;
const tokens = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

test.before(async () => {
  try { await mongoose.connect(URI, { serverSelectionTimeoutMS: 2000 }); await mongoose.connection.dropDatabase(); }
  catch { available = false; return; }
  for (const [role, pass] of [['admin', 'Admin#Test2026'], ['operator', 'Oper#Test2026'], ['viewer', 'View#Test2026']]) {
    await User.create({ email: `${role}@test.local`, role, passwordHash: hashPassword(pass) });
  }
  const app = createApp({ monitor: { live: new Map() }, notifier: {}, config: { jwtSecret: 'x'.repeat(40) }, log: silent });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [role, pass] of [['admin', 'Admin#Test2026'], ['operator', 'Oper#Test2026'], ['viewer', 'View#Test2026']]) {
    tokens[role] = (await call('POST', '/auth/login', { body: { email: `${role}@test.local`, password: pass } })).body.token;
  }
});
test.after(async () => {
  if (!available) return;
  server.close(); await mongoose.connection.dropDatabase(); await mongoose.disconnect();
});

const skipIfNoDb = t => { if (!available) { t.skip('MongoDB недоступна'); return true; } return false; };

test('TC-SEC-01: без токена доступ до даних заборонено (401)', async t => {
  if (skipIfNoDb(t)) return;
  assert.equal((await call('GET', '/routers')).status, 401);
  assert.equal((await call('GET', '/events', { token: 'forged.jwt.token' })).status, 401);
});

test('TC-AUTH-02: невірний пароль — 401 з нейтральним повідомленням і записом в аудит', async t => {
  if (skipIfNoDb(t)) return;
  const r = await call('POST', '/auth/login', { body: { email: 'viewer@test.local', password: 'wrong' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Невірний email або пароль');
  assert.ok(await AuditLog.findOne({ action: 'LOGIN_FAILED', userEmail: 'viewer@test.local' }));
});

test('TC-AUTH-03: після 5 невдалих спроб вхід блокується (429)', async t => {
  if (skipIfNoDb(t)) return;
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { body: { email: 'operator@test.local', password: 'bad' } });
  const r = await call('POST', '/auth/login', { body: { email: 'operator@test.local', password: 'Oper#Test2026' } });
  assert.equal(r.status, 429);
});

test('TC-FUNC-01: оператор додає роутер з коректними даними (201)', async t => {
  if (skipIfNoDb(t)) return;
  const r = await call('POST', '/routers', { token: tokens.operator, body: { name: 'Офіс', ip: '192.168.0.1', type: 'UPNP', isp: 'Воля', area: 'Черга 1' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'UNKNOWN');            // новий роутер не позначається ONLINE до першої перевірки
});

test('TC-VAL-01: некоректні дані роутера відхиляються (400)', async t => {
  if (skipIfNoDb(t)) return;
  for (const body of [{ name: 'Офіс', ip: '999.1.1.1' }, { name: 'A', ip: '10.0.0.1' }, { name: '<script>', ip: '10.0.0.1' },
    { name: 'Офіс', ip: '10.0.0.1', type: 'TELNET' }, { name: 'Офіс', ip: { $gt: '' } }]) {
    assert.equal((await call('POST', '/routers', { token: tokens.operator, body })).status, 400, JSON.stringify(body));
  }
});

test('TC-ACL-01: спостерігач не може додавати, оператор не може видаляти (403)', async t => {
  if (skipIfNoDb(t)) return;
  const r = await Router.findOne();
  assert.equal((await call('POST', '/routers', { token: tokens.viewer, body: { name: 'X1', ip: '10.0.0.9' } })).status, 403);
  assert.equal((await call('DELETE', `/routers/${r._id}`, { token: tokens.operator })).status, 403);
  assert.equal((await call('GET', '/audit', { token: tokens.operator })).status, 403);
});

test('TC-DATA-01: видалення роутера адміністратором видаляє телеметрію і події', async t => {
  if (skipIfNoDb(t)) return;
  const r = await Router.findOne();
  await Telemetry.create({ routerId: r._id, pingLatency: 10 });
  await EventLog.create({ routerId: r._id, cause: 'ISP_OUTAGE', type: 'WARNING' });
  assert.equal((await call('DELETE', `/routers/${r._id}`, { token: tokens.admin })).status, 200);
  assert.equal(await Telemetry.countDocuments({ routerId: r._id }), 0);
  assert.equal(await EventLog.countDocuments({ routerId: r._id }), 0);
  assert.ok(await AuditLog.findOne({ action: 'ROUTER_DELETE', severity: 'high' }));
});

test('TC-NEG-01: неіснуючий або некоректний id — 404, а не 500', async t => {
  if (skipIfNoDb(t)) return;
  assert.equal((await call('DELETE', '/routers/123', { token: tokens.admin })).status, 404);
  assert.equal((await call('DELETE', `/routers/${new mongoose.Types.ObjectId()}`, { token: tokens.admin })).status, 404);
});

test('TC-SEC-02: відповіді не розкривають хеш пароля і технологію сервера', async t => {
  if (skipIfNoDb(t)) return;
  const r = await call('GET', '/users', { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.ok(r.body.every(u => !('passwordHash' in u)));
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('TC-VAL-02: налаштування Telegram — лише адміністратор і лише коректні значення', async t => {
  if (skipIfNoDb(t)) return;
  assert.equal((await call('POST', '/settings/telegram', { token: tokens.operator, body: { chatId: '123456' } })).status, 403);
  assert.equal((await call('POST', '/settings/telegram', { token: tokens.admin, body: { chatId: 'abc' } })).status, 400);
  assert.equal((await call('POST', '/settings/telegram', { token: tokens.admin, body: { interval: 7 } })).status, 400);
  assert.equal((await call('POST', '/settings/telegram', { token: tokens.admin, body: { chatId: '664500000', interval: 60 } })).status, 200);
});

test('createApp відмовляється стартувати зі слабким JWT_SECRET', () => {
  assert.throws(() => createApp({ config: { jwtSecret: 'short' }, log: silent }), /JWT_SECRET/);
});
