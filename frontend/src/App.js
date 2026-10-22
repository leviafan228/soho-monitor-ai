import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const CAUSE_LABEL = {
  POWER_OUTAGE: 'Знеструмлення',
  ISP_OUTAGE: 'Аварія провайдера',
  DEVICE_FAULT: 'Збій роутера',
  DEGRADATION: 'Деградація каналу',
  UNKNOWN: 'Не визначено',
};
const TYPE_COLORS = {
  CRITICAL: { bg: '#fee2e2', fg: '#991b1b' },
  WARNING: { bg: '#fef9c3', fg: '#854d0e' },
  INFO: { bg: '#e0f2fe', fg: '#075985' },
};

export const formatDuration = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h ? `${h} год` : '', m ? `${m} хв` : '', `${r} сек`].filter(Boolean).join(' ');
};

function App() {
  const [routers, setRouters] = useState([]);
  const [telemetryMap, setTelemetryMap] = useState({});
  const [events, setEvents] = useState([]);
  const [mlInfo, setMlInfo] = useState(null);
  const [form, setForm] = useState({ name: '', ip: '', type: 'UPNP', isp: '', area: '' });
  const [showScenarios, setShowScenarios] = useState(false);
  const [tgId, setTgId] = useState('');
  const [tgInterval, setTgInterval] = useState('30');
  const [now, setNow] = useState(Date.now());
  const [offlineTrackers, setOfflineTrackers] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const { data: fetchedRouters } = await axios.get(`${API}/api/routers`);
      setRouters(fetchedRouters);
      setOfflineTrackers(prev => {
        const updated = { ...prev };
        fetchedRouters.forEach(r => {
          if (r.status === 'OFFLINE' && !updated[r._id]) updated[r._id] = Date.now();
          else if (r.status === 'ONLINE' && updated[r._id]) delete updated[r._id];
        });
        return updated;
      });
      const entries = await Promise.all(fetchedRouters.map(async r =>
        [r._id, (await axios.get(`${API}/api/telemetry/${r._id}`)).data]));
      setTelemetryMap(Object.fromEntries(entries));
      setEvents((await axios.get(`${API}/api/events`)).data);
      setError('');
    } catch (e) {
      setError("Немає з'єднання з сервером моніторингу");
    }
  }, []);

  useEffect(() => {
    fetchData();
    axios.get(`${API}/api/ml/info`).then(r => setMlInfo(r.data)).catch(() => {});
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const saveTelegramSettings = async () => {
    try {
      await axios.post(`${API}/api/settings/telegram`, { chatId: tgId, interval: tgInterval });
      alert('Налаштування Telegram оновлено');
    } catch { alert('Помилка збереження налаштувань'); }
  };

  const handleAddRouter = async () => {
    if (!form.name.trim() || !form.ip.trim()) return alert('Введіть назву та IP-адресу');
    try {
      await axios.post(`${API}/api/routers`, form);
      setForm({ name: '', ip: '', type: 'UPNP', isp: '', area: '' });
      fetchData();
    } catch (e) {
      alert(e.response?.data?.error || 'Помилка додавання пристрою');
    }
  };

  const handleDeleteRouter = async (id) => {
    if (window.confirm('Ви дійсно хочете видалити цей пристрій?')) {
      await axios.delete(`${API}/api/routers/${id}`);
      fetchData();
    }
  };

  const runScenario = async (id, kind) => {
    await axios.post(`${API}/api/sim/${id}/scenario`, { kind, durationSec: kind === 'DEVICE_FAULT' ? 40 : 90 });
  };

  const getChartData = (routerId) => {
    const data = telemetryMap[routerId] || [];
    return {
      labels: data.map(t => new Date(t.timestamp).toLocaleTimeString('uk-UA')),
      datasets: [{
        label: 'Затримка, мс', data: data.map(t => t.pingLatency),
        borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 2, tension: 0.3, fill: true,
        pointRadius: data.map(t => (t.anomaly ? 5 : 2)),
        pointBackgroundColor: data.map(t => (t.anomaly ? '#ef4444' : '#3b82f6')),
      }],
    };
  };

  const chartOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
    scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } },
  };

  const styles = {
    page: { backgroundColor: '#f8fafc', minHeight: '100vh', padding: '30px', fontFamily: '"Segoe UI", sans-serif', color: '#1e293b' },
    header: { marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '20px' },
    title: { margin: 0, fontSize: '32px', color: '#0f172a' },
    tgCard: { backgroundColor: '#e0f2fe', padding: '15px', borderRadius: '12px', border: '1px solid #7dd3fc', marginBottom: '20px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' },
    formCard: { backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' },
    input: { padding: '10px 15px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', flex: 1, minWidth: '120px' },
    btnPrimary: { backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
    btnSmall: { backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' },
    scenariosBox: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: '20px', marginBottom: '30px' },
    routerCard: { backgroundColor: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderTop: '4px solid #3b82f6' },
    metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '15px' },
    metricBox: { backgroundColor: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' },
    table: { width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden' },
    th: { textAlign: 'left', padding: '12px', backgroundColor: '#f1f5f9' },
    td: { padding: '12px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' },
    badge: (c) => ({ backgroundColor: c.bg, color: c.fg, padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }),
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Центр моніторингу SOHO</h1>
        <p style={{ color: '#64748b', margin: '6px 0 0' }}>
          Інтелектуальна система: телеметрія, ML-діагностика причин збоїв і виявлення деградації каналу
          {mlInfo && <> · модель v{mlInfo.version}, F1 = {mlInfo.metrics.f1_macro}</>}
        </p>
        {error && <p style={{ color: '#dc2626', fontWeight: 'bold' }}>{error}</p>}
      </div>

      <div style={styles.tgCard}>
        <strong style={{ color: '#0369a1' }}>🛰 Telegram-звіти:</strong>
        <input style={{ ...styles.input, maxWidth: '170px' }} placeholder="Chat ID" value={tgId} onChange={e => setTgId(e.target.value)} />
        <select style={{ ...styles.input, maxWidth: '180px' }} value={tgInterval} onChange={e => setTgInterval(e.target.value)}>
          <option value="10">Кожні 10 секунд</option>
          <option value="30">Кожні 30 секунд</option>
          <option value="60">Кожну 1 хвилину</option>
          <option value="300">Кожні 5 хвилин</option>
        </select>
        <button style={{ ...styles.btnPrimary, backgroundColor: '#0369a1' }} onClick={saveTelegramSettings}>Зберегти</button>
      </div>

      <button style={{ ...styles.btnPrimary, backgroundColor: '#3b82f6', marginBottom: '20px' }} onClick={() => setShowScenarios(!showScenarios)}>
        {showScenarios ? '▼ Сховати опис методу' : '▶ Як система визначає причину збою'}
      </button>
      {showScenarios && (
        <div style={styles.scenariosBox}>
          <ul style={{ fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
            <li><b>Правило (UPnP доступний):</b> після відновлення зв'язку зчитується лічильник uptime. Якщо uptime + T<sub>boot</sub> &lt; тривалості простою — роутер перезавантажувався, отже зникало живлення; інакше — аварія провайдера.</li>
            <li><b>ML-модель (UPnP вимкнено):</b> логістична регресія за непрямими ознаками — тривалість, графік відключень, деградація затримки перед збоєм, одночасна недоступність об'єктів у тій самій зоні чи в того ж провайдера.</li>
            <li><b>Детектор аномалій:</b> EWMA-оцінка норми затримки; стійке перевищення (5 з 10 вимірів, z &gt; 3) — подія «деградація каналу».</li>
          </ul>
        </div>
      )}

      <div style={styles.formCard}>
        <input style={styles.input} placeholder="Назва об'єкта" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input style={styles.input} placeholder="IP-адреса" value={form.ip} onChange={e => setForm({ ...form, ip: e.target.value })} />
        <input style={styles.input} placeholder="Провайдер" value={form.isp} onChange={e => setForm({ ...form, isp: e.target.value })} />
        <input style={styles.input} placeholder="Зона / черга" value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} />
        <select style={{ ...styles.input, maxWidth: '150px' }} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
          <option value="UPNP">UPnP</option>
          <option value="SNMP">SNMP</option>
          <option value="MIKROTIK">MikroTik</option>
          <option value="SIM">Симулятор</option>
        </select>
        <button style={styles.btnPrimary} onClick={handleAddRouter}>+ Додати</button>
      </div>

      <div style={styles.grid}>
        {routers.map(router => {
          const isOnline = router.status === 'ONLINE';
          const offlineStart = offlineTrackers[router._id];
          const offlineMs = offlineStart ? now - offlineStart : 0;
          const live = router.liveData || {};
          return (
            <div key={router._id} style={{ ...styles.routerCard, borderTopColor: isOnline ? (live.degraded ? '#f59e0b' : '#10b981') : '#ef4444' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h3 style={{ margin: '0 0 6px' }}>{router.name} <span style={{ color: '#64748b', fontWeight: 400 }}>({router.ip})</span></h3>
                <button style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer' }} onClick={() => handleDeleteRouter(router._id)}>видалити</button>
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '10px' }}>
                {router.type}{router.isp && ` · ${router.isp}`}{router.area && ` · ${router.area}`}
              </div>

              {!isOnline && offlineStart && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #f87171', padding: '12px', borderRadius: '8px', marginBottom: '12px', color: '#991b1b' }}>
                  <strong>❌ Зв'язок втрачено о {new Date(offlineStart).toLocaleTimeString('uk-UA')}</strong><br />
                  <span style={{ fontSize: '13px' }}>Тривалість: <b>{formatDuration(offlineMs / 1000)}</b>. Причину буде визначено після відновлення зв'язку.</span>
                </div>
              )}
              {isOnline && live.degraded && (
                <div style={{ backgroundColor: '#fffbeb', border: '1px solid #f59e0b', padding: '10px', borderRadius: '8px', marginBottom: '12px', color: '#92400e', fontSize: '13px' }}>
                  ⚠️ <b>Деградація каналу:</b> затримка стабільно вища за норму (z = {live.z}). Можлива аварія провайдера.
                </div>
              )}

              <span style={styles.badge(isOnline ? { bg: '#dcfce3', fg: '#166534' } : router.status === 'OFFLINE' ? { bg: '#fee2e2', fg: '#991b1b' } : { bg: '#f1f5f9', fg: '#475569' })}>
                {isOnline ? '● НА ЗВ\'ЯЗКУ' : router.status === 'OFFLINE' ? '● НЕДОСТУПНИЙ' : '● ОЧІКУВАННЯ ДАНИХ'}
              </span>

              <div style={styles.metricsGrid}>
                <div style={styles.metricBox}><div style={{ fontSize: '10px', color: '#64748b' }}>ЗАТРИМКА</div><div style={{ fontWeight: 'bold', color: '#8b5cf6' }}>{isOnline ? live.pingLatency ?? '--' : '--'} мс</div></div>
                <div style={styles.metricBox}><div style={{ fontSize: '10px', color: '#64748b' }}>UPTIME (UPnP)</div><div style={{ fontWeight: 'bold' }}>{isOnline && live.uptime != null ? formatDuration(live.uptime) : 'н/д'}</div></div>
                <div style={styles.metricBox}><div style={{ fontSize: '10px', color: '#64748b' }}>z-ОЦІНКА</div><div style={{ fontWeight: 'bold' }}>{isOnline ? live.z ?? 0 : '--'}</div></div>
                <div style={styles.metricBox}><div style={{ fontSize: '10px', color: '#64748b' }}>ОСТАННІЙ ЗВ'ЯЗОК</div><div style={{ fontWeight: 'bold' }}>{router.lastSeen ? new Date(router.lastSeen).toLocaleTimeString('uk-UA') : '--'}</div></div>
              </div>

              <div style={{ height: '120px', marginTop: '15px' }}>
                <Line data={getChartData(router._id)} options={chartOptions} />
              </div>

              {router.type === 'SIM' && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Симулювати:</span>
                  <button style={styles.btnSmall} onClick={() => runScenario(router._id, 'POWER_OUTAGE')}>знеструмлення</button>
                  <button style={styles.btnSmall} onClick={() => runScenario(router._id, 'ISP_OUTAGE')}>аварію провайдера</button>
                  <button style={styles.btnSmall} onClick={() => runScenario(router._id, 'DEVICE_FAULT')}>збій роутера</button>
                  <button style={styles.btnSmall} onClick={() => runScenario(router._id, 'DEGRADATION')}>деградацію</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: '22px', marginBottom: '15px' }}>Журнал інцидентів (аналіз після відновлення)</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Об'єкт / час</th>
            <th style={styles.th}>Тривалість</th>
            <th style={styles.th}>Вердикт</th>
            <th style={styles.th}>Пояснення</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && <tr><td colSpan="4" style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>Інцидентів не зафіксовано</td></tr>}
          {events.map(e => (
            <tr key={e._id}>
              <td style={styles.td}>
                <div style={{ fontWeight: 'bold' }}>{e.routerName || '—'}</div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>
                  {e.startedAt
                    ? <>з {new Date(e.startedAt).toLocaleTimeString('uk-UA')} по {new Date(e.endedAt).toLocaleTimeString('uk-UA')}</>
                    : new Date(e.timestamp).toLocaleString('uk-UA')}
                </div>
              </td>
              <td style={styles.td}>{e.downtimeSeconds != null ? formatDuration(e.downtimeSeconds) : '—'}</td>
              <td style={styles.td}>
                <span style={styles.badge(TYPE_COLORS[e.type] || TYPE_COLORS.INFO)}>{CAUSE_LABEL[e.cause] || e.cause}</span>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                  {e.method === 'ml' && `ML-модель, ${Math.round(e.confidence * 100)}%`}
                  {e.method === 'rule' && 'правило за uptime'}
                  {e.method === 'detector' && 'детектор аномалій'}
                </div>
              </td>
              <td style={{ ...styles.td, fontSize: '13px', lineHeight: 1.5 }}>{e.explanation || e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
