// Онлайн-детектор аномалій затримки (EWMA + z-оцінка) для кожного маршрутизатора.
// Ідея: аварії провайдера часто починаються з деградації каналу — затримка й джитер
// зростають за кілька хвилин до повної втрати зв'язку. Детектор помічає це раніше за людину.

class LatencyAnomalyDetector {
  /**
   * @param {object} opts
   * @param {number} opts.alpha     — коефіцієнт згладжування EWMA (0..1)
   * @param {number} opts.threshold — поріг z-оцінки, вище якого точка аномальна
   * @param {number} opts.warmup    — скільки точок потрібно для оцінки «норми»
   * @param {number} opts.window    — розмір вікна для виявлення стійкої деградації
   * @param {number} opts.minHits   — скільки аномалій у вікні означає деградацію
   */
  constructor({ alpha = 0.05, threshold = 3, warmup = 20, window = 10, minHits = 5 } = {}) {
    Object.assign(this, { alpha, threshold, warmup, window, minHits });
    this.state = new Map();
  }

  /** Обробляє нове значення затримки (мс). Повертає {anomaly, z, degraded, mean, std}. */
  update(routerId, latency) {
    const key = String(routerId);
    const s = this.state.get(key) || { n: 0, mean: latency, varr: 0, recent: [] };
    const std = Math.sqrt(s.varr) || 1;
    const z = s.n >= this.warmup ? (latency - s.mean) / Math.max(std, 1) : 0;
    const anomaly = s.n >= this.warmup && z > this.threshold;

    // аномальні точки не «вчать» норму, щоб деградація не стала новою нормою занадто швидко
    if (!anomaly) {
      const diff = latency - s.mean;
      s.mean += this.alpha * diff;
      s.varr = (1 - this.alpha) * (s.varr + this.alpha * diff * diff);
    }
    s.n += 1;
    s.recent.push(anomaly ? 1 : 0);
    if (s.recent.length > this.window) s.recent.shift();
    this.state.set(key, s);
    const degraded = s.recent.reduce((a, b) => a + b, 0) >= this.minHits;
    return { anomaly, z: Number(z.toFixed(2)), degraded, mean: s.mean, std: Math.sqrt(s.varr) };
  }

  reset(routerId) { this.state.delete(String(routerId)); }
}

module.exports = { LatencyAnomalyDetector };
