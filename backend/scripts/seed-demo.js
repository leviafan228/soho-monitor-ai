// Демо-дані для локального запуску: тестові користувачі трьох ролей, симульовані роутери,
// графік відключень. НЕ запускати на робочій базі!
require('dotenv').config();
const mongoose = require('mongoose');
const { User, Router, Settings } = require('../src/models');
const { hashPassword } = require('../src/auth');

const USERS = [
  { email: 'admin@soho.local', name: 'Адміністратор (демо)', role: 'admin', password: 'Admin#Demo2026' },
  { email: 'operator@soho.local', name: 'Оператор (демо)', role: 'operator', password: 'Operator#Demo2026' },
  { email: 'viewer@soho.local', name: 'Спостерігач (демо)', role: 'viewer', password: 'Viewer#Demo2026' },
];

const ROUTERS = [
  { name: 'Кав\'ярня «Зерно»', ip: '10.10.0.1', type: 'SIM', isp: 'Київстар', area: 'Черга 2', upnpControlUrl: 'sim://upnp' },
  { name: 'Салон краси «Ліра»', ip: '10.10.0.2', type: 'SIM', isp: 'Воля', area: 'Черга 2' },
  { name: 'Магазин «Еко»', ip: '10.10.0.3', type: 'SIM', isp: 'Київстар', area: 'Черга 5' },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/soho_monitor');
  for (const u of USERS) {
    await User.findOneAndUpdate({ email: u.email },
      { email: u.email, name: u.name, role: u.role, passwordHash: hashPassword(u.password), active: true }, { upsert: true });
  }
  for (const r of ROUTERS) {
    await Router.findOneAndUpdate({ ip: r.ip }, r, { upsert: true });
  }
  await Settings.findOneAndUpdate({ key: 'blackoutSchedule' }, { value: [
    { area: 'Черга 2', from: 8, to: 12 }, { area: 'Черга 2', from: 20, to: 24 }, { area: 'Черга 5', from: 12, to: 16 },
  ] }, { upsert: true });
  console.log('Демо-дані створено. Облікові записи:');
  USERS.forEach(u => console.log(`  ${u.role.padEnd(8)} ${u.email}  /  ${u.password}`));
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
