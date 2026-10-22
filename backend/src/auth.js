// Автентифікація (JWT) та розмежування прав доступу (RBAC).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ROLES = ['viewer', 'operator', 'admin'];   // кожна наступна роль має всі права попередньої

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function passwordProblems(password) {
  const p = String(password || '');
  const problems = [];
  if (p.length < 10) problems.push('не менше 10 символів');
  if (!/[a-zа-яіїєґ]/.test(p) || !/[A-ZА-ЯІЇЄҐ]/.test(p)) problems.push('великі та малі літери');
  if (!/\d/.test(p)) problems.push('хоча б одна цифра');
  return problems;
}

function signToken(user, secret, expiresIn = '8h') {
  return jwt.sign({ sub: String(user._id), role: user.role, email: user.email }, secret, { expiresIn });
}

function authMiddleware(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Потрібна автентифікація' });
    try {
      req.user = jwt.verify(token, secret);
      next();
    } catch {
      res.status(401).json({ error: 'Сесія недійсна або закінчилася' });
    }
  };
}

const requireRole = min => (req, res, next) => {
  if (ROLES.indexOf(req.user?.role) >= ROLES.indexOf(min)) return next();
  res.status(403).json({ error: 'Недостатньо прав' });
};

// Просте обмеження частоти спроб входу: не більше `max` невдалих спроб за `windowMs` з однієї IP-адреси
class LoginLimiter {
  constructor({ max = 5, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    Object.assign(this, { max, windowMs, now });
    this.fails = new Map();
  }
  blocked(key) {
    const list = (this.fails.get(key) || []).filter(t => t > this.now() - this.windowMs);
    this.fails.set(key, list);
    return list.length >= this.max;
  }
  fail(key) { this.fails.set(key, [...(this.fails.get(key) || []), this.now()]); }
  reset(key) { this.fails.delete(key); }
}

module.exports = { ROLES, hashPassword, verifyPassword, passwordProblems, signToken, authMiddleware, requireRole, LoginLimiter };
