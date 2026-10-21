# Розгортання та експлуатація SOHO Monitor AI

## Середовище
| Компонент | Вимоги |
|---|---|
| Тип системи | вебзастосунок (SPA + REST API) з фоновим сервісом опитування |
| Backend | Node.js ≥ 20, Express 5, Mongoose 9 |
| Frontend | React 19, Chart.js (збирається в статичні файли) |
| База даних | MongoDB ≥ 6 (локально, у Docker або MongoDB Atlas) |
| ML | Python 3.10+, scikit-learn — тільки для навчання; у продакшні модель — файл `model.json` |
| Мережа | сервер має бачити IP-адреси роутерів (та сама LAN, VPN або публічні адреси) |

## Варіант 1. Docker Compose (рекомендовано)
```bash
cp backend/.env.example backend/.env    # заповнити JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, Telegram
docker compose up -d --build
docker compose logs -f backend
```
Сервіси: `mongo` (том `mongo-data`), `backend` (порт 5000), `frontend` (nginx, порт 8080).
Перший адміністратор створюється автоматично з `ADMIN_EMAIL` / `ADMIN_PASSWORD`, якщо в БД немає користувачів.

## Варіант 2. Вручну (див. README)
`npm start` у backend, `npm run build` у frontend і віддача `frontend/build` будь-яким вебсервером.

## Змінні середовища (backend/.env)
| Змінна | Призначення |
|---|---|
| PORT | порт API (5000) |
| MONGO_URI | рядок підключення до MongoDB |
| JWT_SECRET | секрет підпису токенів, ≥ 32 випадкові символи (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| ADMIN_EMAIL, ADMIN_PASSWORD | перший адміністратор |
| CORS_ORIGIN | адреса фронтенду |
| TELEGRAM_TOKEN, TELEGRAM_CHAT_ID | сповіщення (необов'язково) |
| POLL_INTERVAL_MS, HEARTBEAT_MS | частота опитування і регулярного звіту |
| LOG_DIR | каталог для `app.log` |
| BACKUP_DIR, BACKUP_KEEP | каталог і кількість резервних копій |

## Резервне копіювання та відновлення
| Об'єкт | Періодичність | Де зберігати | Відповідальний | Перевірка | Відновлення |
|---|---|---|---|---|---|
| База даних (роутери, події, користувачі, налаштування, аудит) | щодня о 03:00 + перед кожним оновленням | `backups/` на сервері + копія в хмарне сховище | адміністратор | `npm run backup:verify` щодня; щомісяця тестове відновлення в окрему БД | `node scripts/backup.js --restore backups/<дата>` |
| Телеметрія | щодня разом з БД (зберігається 7 днів) | те саме | адміністратор | кількість документів у manifest.json | те саме |
| Конфігурація (`.env`) | при кожній зміні | менеджер паролів / зашифроване сховище, **не Git** | адміністратор | порівняння з `.env.example` | відновити файл і перезапустити сервіс |
| Код і модель ML | при кожному коміті | GitHub | розробник | CI-тести | `git clone` + `npm install` |

Планування (Windows Task Scheduler / cron): `0 3 * * * cd /opt/soho/backend && npm run backup`.

## Моніторинг роботи самої системи
- `GET /api/health` — для зовнішнього аптайм-монітора (наприклад, UptimeRobot) кожні 5 хв;
- `logs/app.log` — рівні info / warn / error; помилки `error` переглядати щодня;
- Telegram heartbeat: якщо регулярний звіт не прийшов — сервер моніторингу недоступний.

## Оновлення
1. `npm run backup` → 2. `git pull` → 3. `npm ci` → 4. `npm test` → 5. перезапуск сервісу →
6. перевірка `/api/health` і входу → 7. у разі проблем — відкат на попередній тег і відновлення копії.

## Перенавчання моделі
Інциденти роутерів з UPnP отримують мітку від правила автоматично, а оператори підтверджують причину
для решти (`PATCH /api/events/:id/confirm`). Раз на місяць:
```bash
cd ml && python retrain_from_events.py --mongo mongodb://127.0.0.1:27017/soho_monitor
```
Скрипт додає розмічені реальні події до датасету, перенавчає модель і оновлює `model.json` лише якщо
F1 на відкладеній вибірці не погіршився.
