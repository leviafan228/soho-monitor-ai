const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, passwordProblems, LoginLimiter } = require('../src/auth');
const { validateRouter } = require('../src/validation');
const { mask } = require('../src/logger');

test('паролі зберігаються як scrypt-хеш із сіллю, однаковий пароль — різні хеші', () => {
  const a = hashPassword('Secret#2026x'), b = hashPassword('Secret#2026x');
  assert.notEqual(a, b);
  assert.ok(!a.includes('Secret#2026x'));
  assert.ok(verifyPassword('Secret#2026x', a));
  assert.ok(!verifyPassword('secret#2026x', a));
});

test('політика паролів', () => {
  assert.deepEqual(passwordProblems('Strong#Pass1'), []);
  assert.ok(passwordProblems('short1A').length > 0);
  assert.ok(passwordProblems('alllowercase123').length > 0);
});

test('лог не містить паролів і токенів Telegram', () => {
  const m = mask({ email: 'a@b.c', password: 'x', nested: { token: 'y' }, msg: 'bot 8663379645:AAF6V28-KAbmrtFyltnL4ssQPZxd79OR1zw' });
  assert.equal(m.password, '***');
  assert.equal(m.nested.token, '***');
  assert.ok(!m.msg.includes('AAF6V28'));
});

test('обмежувач спроб входу: блок після 5 невдач, розблокування через 15 хв', () => {
  let now = 0; const l = new LoginLimiter({ now: () => now });
  for (let i = 0; i < 5; i++) l.fail('k');
  assert.equal(l.blocked('k'), true);
  now += 15 * 60 * 1000 + 1;
  assert.equal(l.blocked('k'), false);
});

// Класи еквівалентності та граничні значення поля «назва» (2..60 символів) та IP
test('BVA: довжина назви роутера 1/2/60/61 символ', () => {
  const ip = '10.0.0.1';
  assert.equal(validateRouter({ name: 'A', ip }).length, 1);
  assert.equal(validateRouter({ name: 'AB', ip }).length, 0);
  assert.equal(validateRouter({ name: 'A'.repeat(60), ip }).length, 0);
  assert.equal(validateRouter({ name: 'A'.repeat(61), ip }).length, 1);
});

test('EP: IPv4 і доменні імена', () => {
  for (const ip of ['0.0.0.0', '192.168.1.1', '255.255.255.255', 'router.office.local']) assert.equal(validateRouter({ name: 'Офіс', ip }).length, 0, ip);
  for (const ip of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '', '10.0.0.-1', '12345']) assert.equal(validateRouter({ name: 'Офіс', ip }).length, 1, ip);
});
