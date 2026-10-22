const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeOutage, T_BOOT } = require('../src/services/analyzer');

const quietFeatures = { log_downtime: Math.log(120), hour_sin: 0, hour_cos: 1, scheduled_blackout: 0, latency_ratio: 1,
  jitter_ms: 3, loss_before: 0, peers_area_down: 0, peers_isp_down: 0 };

test('правило: uptime менший за простій (роутер перезавантажився) => знеструмлення', () => {
  const v = analyzeOutage({ downtimeSec: 3600, uptimeSec: 100, features: { ...quietFeatures, peers_area_down: 0.6 } });
  assert.equal(v.cause, 'POWER_OUTAGE');
  assert.equal(v.type, 'CRITICAL');
  assert.equal(v.method, 'rule');
});

test('правило: uptime більший за простій => аварія провайдера', () => {
  const v = analyzeOutage({ downtimeSec: 600, uptimeSec: 86400, features: quietFeatures });
  assert.equal(v.cause, 'ISP_OUTAGE');
  assert.equal(v.type, 'WARNING');
});

test('правило: гранична умова uptime + T_boot = downtime => провайдер (нерівність строга)', () => {
  const v = analyzeOutage({ downtimeSec: 400, uptimeSec: 400 - T_BOOT, features: quietFeatures });
  assert.equal(v.cause, 'ISP_OUTAGE');
});

test('правило: коротке перезавантаження без сусідів у зоні => збій пристрою', () => {
  const v = analyzeOutage({ downtimeSec: 150, uptimeSec: 60, features: quietFeatures });
  assert.equal(v.cause, 'DEVICE_FAULT');
});

test('ML: uptime недоступний => рішення приймає класифікатор', () => {
  const v = analyzeOutage({ downtimeSec: 150, uptimeSec: null, features: quietFeatures });
  assert.equal(v.method, 'ml');
  assert.ok(v.confidence > 0 && v.confidence <= 1);
  assert.ok(['POWER_OUTAGE', 'ISP_OUTAGE', 'DEVICE_FAULT', 'UNKNOWN'].includes(v.cause));
});

test('ML без ознак — помилка, а не мовчазний хибний вердикт', () => {
  assert.throws(() => analyzeOutage({ downtimeSec: 100, uptimeSec: null }), /потрібні ознаки/);
});

test('пояснення містить тривалість і рекомендацію', () => {
  const v = analyzeOutage({ downtimeSec: 3725, uptimeSec: 10, features: { ...quietFeatures, peers_area_down: 0.8 } });
  assert.match(v.explanation, /1 год 2 хв 5 с/);
  assert.match(v.explanation, /Рекомендація/);
});
