// Демонстраційний сценарій для симульованих роутерів (потрібен запущений сервер і npm run seed:demo).
// 1) блекаут у «Черзі 2» — одночасно падають два об'єкти зони;
// 2) деградація каналу в магазині; 3) аварія провайдера в магазині.
const API = process.env.API_URL || 'http://localhost:5000/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  const { token } = await req('POST', '/auth/login', null, { email: 'admin@soho.local', password: process.env.DEMO_ADMIN_PASSWORD || 'Admin#Demo2026' });
  const routers = await req('GET', '/routers', token);
  const byName = n => routers.find(r => r.name.includes(n));
  const [cafe, salon, shop] = [byName('Зерно'), byName('Ліра'), byName('Еко')];
  console.log('Збираємо базову телеметрію 150 с…'); await sleep(150000);
  console.log('Сценарій 1: блекаут у Черзі 2');
  await req('POST', `/sim/${cafe._id}/scenario`, token, { kind: 'POWER_OUTAGE', durationSec: 120 });
  await req('POST', `/sim/${salon._id}/scenario`, token, { kind: 'POWER_OUTAGE', durationSec: 120 });
  console.log('Сценарій 2: деградація каналу в магазині');
  await req('POST', `/sim/${shop._id}/scenario`, token, { kind: 'DEGRADATION', durationSec: 90 });
  await sleep(200000);
  console.log('Сценарій 3: аварія провайдера в магазині');
  await req('POST', `/sim/${shop._id}/scenario`, token, { kind: 'ISP_OUTAGE', durationSec: 100 });
  await sleep(190000);
  const events = await req('GET', '/events', token);
  events.forEach(e => console.log(`${e.routerName}: ${e.cause} (${e.method}${e.confidence != null ? ', ' + Math.round(e.confidence * 100) + '%' : ''}), ${e.downtimeSeconds ?? '-'} с`));
})().catch(e => { console.error(e.message); process.exit(1); });
