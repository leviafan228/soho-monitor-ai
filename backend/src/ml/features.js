// Обчислення ознак інциденту для класифікатора (ті самі, що в ml/generate_dataset.py).

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/** Чи потрапляє момент у вікно графіка відключень. schedule: [{area, from, to}] — години 0..24. */
function inBlackoutSchedule(date, area, schedule = []) {
  const h = date.getHours() + date.getMinutes() / 60;
  return schedule.some(w => w.area === area && (w.from <= w.to ? h >= w.from && h < w.to : h >= w.from || h < w.to));
}

/**
 * @param {object} p
 * @param {number} p.downtimeSec   — тривалість простою, с
 * @param {Date}   p.startedAt     — момент втрати зв'язку
 * @param {number[]} p.latencyBefore   — затримки (мс) за 2 хв до збою
 * @param {number[]} p.latencyBaseline — затримки (мс) за останню годину до збою
 * @param {number} p.failedProbes  — кількість невдалих опитувань за 2 хв до збою
 * @param {number} p.totalProbes   — загальна кількість опитувань за 2 хв до збою
 * @param {number} p.peersAreaDown — частка інших об'єктів тієї ж зони електропостачання, недоступних одночасно
 * @param {number} p.peersIspDown  — частка інших об'єктів того ж провайдера, недоступних одночасно
 * @param {boolean} p.scheduled    — чи збіг початок збою з графіком відключень
 */
function buildFeatures(p) {
  const hour = p.startedAt.getHours() + p.startedAt.getMinutes() / 60;
  const base = mean(p.latencyBaseline) || mean(p.latencyBefore) || 1;
  return {
    log_downtime: Math.log(Math.max(p.downtimeSec, 10)),
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    scheduled_blackout: p.scheduled ? 1 : 0,
    latency_ratio: p.latencyBefore.length ? Math.max(mean(p.latencyBefore) / base, 0.3) : 1,
    jitter_ms: std(p.latencyBefore),
    loss_before: p.totalProbes ? p.failedProbes / p.totalProbes : 0,
    peers_area_down: p.peersAreaDown || 0,
    peers_isp_down: p.peersIspDown || 0,
  };
}

module.exports = { buildFeatures, inBlackoutSchedule, mean, std };
