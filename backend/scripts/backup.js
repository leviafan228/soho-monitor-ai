// Резервне копіювання БД у JSON (працює без mongodump). Зберігає останні BACKUP_KEEP копій.
// Використання: node scripts/backup.js            — створити копію
//               node scripts/backup.js --verify   — перевірити останню копію (читається, кількості збігаються)
//               node scripts/backup.js --restore <папка>  — відновити з копії (ПЕРЕЗАПИСУЄ колекції!)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const COLLECTIONS = ['routers', 'eventlogs', 'users', 'settings', 'auditlogs', 'telemetries'];

async function backup(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(DIR, stamp);
  fs.mkdirSync(target, { recursive: true });
  const manifest = {};
  for (const name of COLLECTIONS) {
    const docs = await db.collection(name).find().toArray();
    fs.writeFileSync(path.join(target, `${name}.json`), EJSON.stringify(docs));
    manifest[name] = docs.length;
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ createdAt: new Date(), counts: manifest }, null, 1));
  const all = fs.readdirSync(DIR).filter(d => fs.existsSync(path.join(DIR, d, 'manifest.json'))).sort();
  all.slice(0, Math.max(0, all.length - KEEP)).forEach(d => fs.rmSync(path.join(DIR, d), { recursive: true }));
  console.log('Резервну копію створено:', target, manifest);
}

function latest() {
  const all = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(d => fs.existsSync(path.join(DIR, d, 'manifest.json'))).sort() : [];
  if (!all.length) throw new Error('Резервних копій немає');
  return path.join(DIR, all[all.length - 1]);
}

function verify(dir = latest()) {
  const { counts } = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  for (const [name, n] of Object.entries(counts)) {
    const docs = EJSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    if (docs.length !== n) throw new Error(`${name}: очікувалось ${n}, у файлі ${docs.length}`);
  }
  console.log('Копія коректна:', dir, counts);
}

async function restore(db, dir) {
  verify(dir);
  for (const name of COLLECTIONS) {
    const docs = EJSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    await db.collection(name).deleteMany({});
    if (docs.length) await db.collection(name).insertMany(docs);
  }
  console.log('Відновлено з', dir);
}

(async () => {
  const [mode, arg] = process.argv.slice(2);
  if (mode === '--verify') return verify(arg);
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/soho_monitor');
  if (mode === '--restore') await restore(mongoose.connection.db, arg || latest());
  else await backup(mongoose.connection.db);
  await mongoose.disconnect();
})().catch(e => { console.error('Помилка:', e.message); process.exit(1); });
