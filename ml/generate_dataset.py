"""Генерація навчального датасету інцидентів втрати зв'язку SOHO-маршрутизаторів.

Чому синтетичні дані: на старті експлуатації розмічених інцидентів мало. Датасет моделює
три причини збою з параметрами, взятими з досвіду експлуатації дипломної системи та графіків
відключень електроенергії 2024–2026 рр. Після запуску в експлуатацію модель перенавчається
на реальних подіях: інциденти роутерів з доступним UPnP автоматично отримують мітку від
детермінованого правила (uptime + T_boot < downtime) — це слабка розмітка (weak supervision),
яка накопичує реальний датасет без ручної роботи (див. ml/retrain_from_events.py).

Ознаки (усі доступні БЕЗ лічильника uptime, тобто працюють і для роутерів із вимкненим UPnP):
  log_downtime        — ln(тривалість простою, с)
  hour_sin, hour_cos  — година початку збою (циклічне кодування)
  scheduled_blackout  — 1, якщо початок збою потрапив у вікно графіка відключень для зони об'єкта
  latency_ratio       — середня затримка за 2 хв до збою / базова затримка за 1 год
  jitter_ms           — стандартне відхилення затримки за 2 хв до збою
  loss_before         — частка невдалих опитувань за 2 хв до збою
  peers_area_down     — частка інших об'єктів у тій самій зоні електропостачання, недоступних одночасно
  peers_isp_down      — частка інших об'єктів того самого провайдера, недоступних одночасно
Класи: POWER_OUTAGE (знеструмлення), ISP_OUTAGE (аварія провайдера), DEVICE_FAULT (зависання/перезавантаження роутера).
"""
import numpy as np
import pandas as pd
from pathlib import Path

FEATURES = ['log_downtime', 'hour_sin', 'hour_cos', 'scheduled_blackout', 'latency_ratio',
            'jitter_ms', 'loss_before', 'peers_area_down', 'peers_isp_down']
CLASSES = ['POWER_OUTAGE', 'ISP_OUTAGE', 'DEVICE_FAULT']


def generate(n=6000, seed=7):
    rng = np.random.default_rng(seed)
    y = rng.choice(3, size=n, p=[0.45, 0.40, 0.15])
    rows = []
    for c in y:
        if c == 0:   # знеструмлення: довге, частіше за графіком, обрив різкий, падає вся зона
            downtime = rng.lognormal(np.log(2.5 * 3600), 0.7) if rng.random() < 0.75 else rng.lognormal(np.log(600), 0.9)
            sched = rng.random() < 0.65
            hour = rng.choice([0, 4, 8, 12, 16, 20]) + rng.normal(0, 0.4) if sched else rng.uniform(0, 24)
            lat_ratio = rng.normal(1.02, 0.12)
            jitter = abs(rng.normal(3, 2))
            loss = rng.beta(1, 40)
            area = np.clip(rng.normal(0.55, 0.25), 0, 1) if rng.random() < 0.8 else rng.beta(1, 8)
            isp = rng.beta(1.5, 6)
        elif c == 1:  # аварія провайдера: середня тривалість, перед збоєм деградація каналу, падають клієнти того ж ISP
            downtime = rng.lognormal(np.log(25 * 60), 0.9)
            sched = rng.random() < 0.15
            hour = rng.uniform(0, 24)
            lat_ratio = rng.lognormal(np.log(1.5), 0.3) if rng.random() < 0.7 else rng.normal(1.05, 0.12)
            jitter = abs(rng.normal(14, 8))
            loss = rng.beta(2, 12)
            area = rng.beta(1.2, 7)
            isp = np.clip(rng.normal(0.5, 0.25), 0, 1) if rng.random() < 0.75 else rng.beta(1, 8)
        else:         # збій пристрою: коротко, поодиноко, без деградації і без сусідів
            downtime = rng.lognormal(np.log(150), 0.6)
            sched = rng.random() < 0.1
            hour = rng.uniform(0, 24)
            lat_ratio = rng.normal(1.1, 0.25)
            jitter = abs(rng.normal(6, 5))
            loss = rng.beta(1, 15)
            area = rng.beta(1, 15)
            isp = rng.beta(1, 15)
        hour = hour % 24
        rows.append([np.log(max(downtime, 10)), np.sin(2 * np.pi * hour / 24), np.cos(2 * np.pi * hour / 24),
                     float(sched), max(lat_ratio, 0.3), jitter, loss, area, isp])
    df = pd.DataFrame(rows, columns=FEATURES)
    df['label'] = [CLASSES[c] for c in y]
    return df


if __name__ == '__main__':
    df = generate()
    out = Path(__file__).parent / 'data' / 'incidents_synthetic.csv'
    out.parent.mkdir(exist_ok=True)
    df.round(5).to_csv(out, index=False)
    print(df['label'].value_counts().to_string())
    print('saved', out, df.shape)
