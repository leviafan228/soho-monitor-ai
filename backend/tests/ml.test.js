const test = require('node:test');
const assert = require('node:assert/strict');
const { predict, model } = require('../src/ml/classifier');
const { LatencyAnomalyDetector } = require('../src/ml/anomaly');
const { buildFeatures, inBlackoutSchedule } = require('../src/ml/features');
const ref = require('./fixtures_model_reference.json');

const toFeatures = x => Object.fromEntries(model.features.map((n, i) => [n, x[i]]));

test('класифікатор: ймовірності збігаються з sklearn (еталон з навчання)', () => {
  ref.X.forEach((x, i) => {
    const p = predict(toFeatures(x)).probabilities;
    model.classes.forEach((c, k) => assert.ok(Math.abs(p[c] - ref.proba[i][k]) < 1e-4, `${i}/${c}`));
  });
});

test('класифікатор: сума ймовірностей = 1', () => {
  const p = predict(toFeatures(ref.X[0])).probabilities;
  assert.ok(Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('класифікатор: відсутня ознака — зрозуміла помилка', () => {
  assert.throws(() => predict({ log_downtime: 5 }), /Відсутня ознака/);
});

test('класифікатор: типове знеструмлення за графіком розпізнається як POWER_OUTAGE', () => {
  const f = buildFeatures({ downtimeSec: 3 * 3600, startedAt: new Date('2026-10-20T16:00:00'), latencyBefore: [20, 21, 19],
    latencyBaseline: [20, 20, 21], failedProbes: 0, totalProbes: 24, peersAreaDown: 0.7, peersIspDown: 0.1, scheduled: true });
  assert.equal(predict(f).label, 'POWER_OUTAGE');
});

test('класифікатор: деградація + сусіди провайдера => ISP_OUTAGE', () => {
  const f = buildFeatures({ downtimeSec: 1800, startedAt: new Date('2026-10-20T11:13:00'), latencyBefore: [40, 55, 70, 38, 90],
    latencyBaseline: [20, 21, 22, 19], failedProbes: 4, totalProbes: 24, peersAreaDown: 0, peersIspDown: 0.6, scheduled: false });
  assert.equal(predict(f).label, 'ISP_OUTAGE');
});

test('детектор: стабільна затримка не дає аномалій, сплеск — дає', () => {
  const d = new LatencyAnomalyDetector();
  for (let i = 0; i < 50; i++) assert.equal(d.update('r', 20 + (i % 3)).anomaly, false);
  const r = d.update('r', 120);
  assert.equal(r.anomaly, true);
  assert.ok(r.z > 3);
});

test('детектор: стійка деградація фіксується після 5 аномалій з 10', () => {
  const d = new LatencyAnomalyDetector();
  for (let i = 0; i < 30; i++) d.update('r', 20);
  let r;
  for (let i = 0; i < 4; i++) r = d.update('r', 100);
  assert.equal(r.degraded, false);
  r = d.update('r', 100);
  assert.equal(r.degraded, true);
});

test('ознаки: графік відключень, у т.ч. вікно через північ', () => {
  const sched = [{ area: 'Черга 3', from: 22, to: 2 }];
  assert.equal(inBlackoutSchedule(new Date('2026-10-20T23:30:00'), 'Черга 3', sched), true);
  assert.equal(inBlackoutSchedule(new Date('2026-10-20T01:00:00'), 'Черга 3', sched), true);
  assert.equal(inBlackoutSchedule(new Date('2026-10-20T12:00:00'), 'Черга 3', sched), false);
  assert.equal(inBlackoutSchedule(new Date('2026-10-20T23:30:00'), 'Черга 1', sched), false);
});
