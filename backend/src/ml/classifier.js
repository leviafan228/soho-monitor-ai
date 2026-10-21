// Інференс класифікатора причин збою (softmax-логістична регресія).
// Модель навчається в ml/train_classifier.py і експортується в model.json.
const model = require('./model.json');

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

/**
 * @param {Object<string, number>} features — значення ознак за іменами з model.features
 * @returns {{label: string, confidence: number, probabilities: Object<string, number>}}
 */
function predict(features, m = model) {
  const x = m.features.map((name, i) => {
    const v = features[name];
    if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`Відсутня ознака: ${name}`);
    return (v - m.mean[i]) / m.scale[i];
  });
  const logits = m.coef.map((w, k) => w.reduce((s, wi, i) => s + wi * x[i], m.intercept[k]));
  const p = softmax(logits);
  const best = p.indexOf(Math.max(...p));
  const probabilities = Object.fromEntries(m.classes.map((c, k) => [c, p[k]]));
  const label = p[best] >= m.confidence_threshold ? m.classes[best] : 'UNKNOWN';
  return { label, confidence: p[best], probabilities };
}

module.exports = { predict, model };
