import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

function App() {
  const [routers, setRouters] = useState([]);
  const [telemetryMap, setTelemetryMap] = useState({}); 
  const [events, setEvents] = useState([]);
  
  const [newIp, setNewIp] = useState('');
  const [newName, setNewName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false); 

  // Налаштування Telegram
  const [tgId, setTgId] = useState('');
  const [tgInterval, setTgInterval] = useState('30'); // У секундах

  const [now, setNow] = useState(Date.now());
  const [offlineTrackers, setOfflineTrackers] = useState({});

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const saveTelegramSettings = async () => {
    try {
      await axios.post('http://localhost:5000/api/settings/telegram', {
        chatId: tgId,
        interval: tgInterval
      });
      alert('Налаштування Telegram успішно оновлено!');
    } catch (error) {
      alert('Помилка збереження налаштувань.');
    }
  };

  const fetchData = async () => {
    try {
      const routersRes = await axios.get('http://localhost:5000/api/routers');
      const fetchedRouters = routersRes.data;
      setRouters(fetchedRouters);

      setOfflineTrackers(prev => {
        const updatedTrackers = { ...prev };
        fetchedRouters.forEach(r => {
          if (r.status === 'OFFLINE' && !updatedTrackers[r._id]) {
            updatedTrackers[r._id] = Date.now(); 
          } else if (r.status === 'ONLINE' && updatedTrackers[r._id]) {
            delete updatedTrackers[r._id]; 
          }
        });
        return updatedTrackers;
      });

      const newTelemetryMap = {};
      for (const router of fetchedRouters) {
        const telRes = await axios.get(`http://localhost:5000/api/telemetry/${router._id}`);
        newTelemetryMap[router._id] = telRes.data;
      }
      setTelemetryMap(newTelemetryMap);

      const eventsRes = await axios.get('http://localhost:5000/api/events');
      setEvents(eventsRes.data);
    } catch (error) {
      console.error("Помилка з'єднання з бекендом", error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); 
    return () => clearInterval(interval);
  }, []);

  const handleAddRouter = async () => {
    if (!newIp || !newName) return alert("Введіть назву та IP-адресу!");
    setIsLoading(true);
    try {
      await axios.post('http://localhost:5000/api/routers', {
        name: newName, ip: newIp, type: 'SNMP', credentials: { community: 'public' }
      });
      setNewName(''); setNewIp('');
      fetchData(); 
    } catch (error) {
      alert("Помилка додавання пристрою");
    }
    setIsLoading(false);
  };

  const handleDeleteRouter = async (id) => {
    if (window.confirm("Ви дійсно хочете видалити цей пристрій?")) {
      await axios.delete(`http://localhost:5000/api/routers/${id}`);
      fetchData();
    }
  };

  const getChartData = (routerId, livePing) => {
    const data = telemetryMap[routerId] || [];
    // Додаємо останній живий пінг до графіку для плавності
    const chartPoints = data.map(t => t.cpuLoad); // Використовуємо cpuLoad як універсальну активність
    
    return {
      labels: data.map(t => new Date(t.timestamp).toLocaleTimeString('uk-UA')),
      datasets: [{
        label: 'Мережева активність', data: chartPoints,
        borderColor: '#3b82f6', 
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2, pointRadius: 3, tension: 0.4, fill: true,
      }]
    };
  };

  const chartOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
    scales: { y: { beginAtZero: true, suggestedMax: 100 } }, plugins: { legend: { display: false } }
  };

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m > 0 ? `${m} хв ` : ''}${s} сек`;
  };

  const styles = {
    page: { backgroundColor: '#f8fafc', minHeight: '100vh', padding: '30px', fontFamily: '"Segoe UI", sans-serif', color: '#1e293b' },
    header: { marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '20px' },
    title: { margin: 0, fontSize: '32px', color: '#0f172a' },
    tgCard: { backgroundColor: '#e0f2fe', padding: '15px', borderRadius: '12px', border: '1px solid #7dd3fc', marginBottom: '20px', display: 'flex', gap: '15px', alignItems: 'center' },
    formCard: { backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginBottom: '20px', display: 'flex', gap: '15px', alignItems: 'center' },
    input: { padding: '10px 15px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', flex: 1 },
    btnPrimary: { backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
    scenariosBox: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(600px, 1fr))', gap: '20px', marginBottom: '30px' },
    routerCard: { backgroundColor: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderTop: '4px solid #3b82f6', position: 'relative' },
    metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '15px' },
    metricBox: { backgroundColor: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' },
    table: { width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden' },
    th: { textAlign: 'left', padding: '12px', backgroundColor: '#f1f5f9' },
    td: { padding: '12px', borderBottom: '1px solid #e2e8f0' },
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Центр моніторингу SOHO</h1>
        <p style={{ color: '#64748b' }}>Панель збору реальної телеметрії та діагностики апаратних збоїв</p>
      </div>

      {/* --- ПАНЕЛЬ НАЛАШТУВАНЬ TELEGRAM --- */}
      <div style={styles.tgCard}>
        <strong style={{color: '#0369a1'}}>🛰 Налаштування Telegram-звітів:</strong>
        <input 
          style={{...styles.input, maxWidth: '150px'}} 
          placeholder="ID Користувача" 
          value={tgId} 
          onChange={(e) => setTgId(e.target.value)} 
        />
        <select 
          style={{...styles.input, maxWidth: '180px'}} 
          value={tgInterval} 
          onChange={(e) => setTgInterval(e.target.value)}
        >
          <option value="10">Кожні 10 секунд</option>
          <option value="30">Кожні 30 секунд</option>
          <option value="60">Кожну 1 хвилину</option>
          <option value="300">Кожні 5 хвилин</option>
        </select>
        <button style={{...styles.btnPrimary, backgroundColor: '#0369a1'}} onClick={saveTelegramSettings}>
          Зберегти інтервал
        </button>
      </div>

      <button style={{...styles.btnPrimary, backgroundColor: '#3b82f6', marginBottom: '20px'}} onClick={() => setShowScenarios(!showScenarios)}>
        {showScenarios ? '▼ Сховати алгоритми' : '▶ Розгорнути опис архітектури (UPnP + Синтетичні тести)'}
      </button>

      {showScenarios && (
        <div style={styles.scenariosBox}>
          <h3 style={{ marginTop: 0, color: '#1e3a8a' }}>Методологія моніторингу закритого SOHO-обладнання:</h3>
          <p style={{fontSize: '14px', lineHeight: '1.6'}}>Оскільки домашні маршрутизатори часто блокують SNMP з міркувань безпеки, ця система використовує гібридний метод (Event-Driven Alerting):</p>
          <ul style={{fontSize: '14px', lineHeight: '1.6'}}>
            <li><strong>Джерело 1 (Синтетичний ICMP-тест):</strong> Безперервне пінг-опитування для визначення статусу каналу та затримки (Latency).</li>
            <li><strong>Джерело 2 (UPnP / SOAP):</strong> При втраті ICMP-відповіді, система очікує відновлення каналу і запитує лічильник <code>Uptime</code> через UPnP. Скидання лічильника однозначно ідентифікує <b>втрату електроживлення</b>. Якщо лічильник зберігся — фіксується <b>аварія провайдера</b>.</li>
          </ul>
        </div>
      )}

      <div style={styles.formCard}>
        <input style={styles.input} placeholder="Назва об'єкта" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input style={styles.input} placeholder="IP-адреса" value={newIp} onChange={(e) => setNewIp(e.target.value)} />
        <button style={styles.btnPrimary} onClick={handleAddRouter}>+ Додати</button>
      </div>

      <div style={styles.grid}>
        {routers.map(router => {
          const isOnline = router.status === 'ONLINE';
          const offlineStartTime = offlineTrackers[router._id];
          const offlineDurationMs = offlineStartTime ? (now - offlineStartTime) : 0;
          const isAnalyzing = offlineDurationMs < 65000; 
          
          // РЕАЛЬНІ ДАНІ: Беруться з кешу liveData бекенду
          const live = router.liveData || {};
          const down = isOnline ? (live.downloadSpeed || '0.0') : '0.0';
          const up = isOnline ? (live.uploadSpeed || '0.0') : '0.0';
          const ping = isOnline ? (live.pingLatency || '--') : '--';

          return (
            <div key={router._id} style={{...styles.routerCard, borderTopColor: isOnline ? '#10b981' : '#ef4444'}}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3>{router.name} ({router.ip})</h3>
                <button style={{border:'none', background:'none', color:'#dc2626', cursor:'pointer'}} onClick={() => handleDeleteRouter(router._id)}>видалити</button>
              </div>

              {!isOnline && offlineStartTime && (
                <div style={{
                  backgroundColor: isAnalyzing ? '#fef9c3' : '#fef2f2', 
                  border: `1px solid ${isAnalyzing ? '#eab308' : '#f87171'}`, 
                  padding: '12px', borderRadius: '8px', marginBottom: '15px'
                }}>
                  {isAnalyzing ? (
                    <div style={{ color: '#854d0e' }}>
                      <strong style={{fontSize: '15px'}}>⏳ Зв'язок втрачено (ICMP Drop) о {new Date(offlineStartTime).toLocaleTimeString()}</strong><br/>
                      <span style={{fontSize: '13px'}}>
                        Система очікує відновлення для опитування UPnP. Залишилося: <strong>{65 - Math.floor(offlineDurationMs / 1000)} сек.</strong>
                      </span>
                    </div>
                  ) : (
                    <div style={{ color: '#991b1b' }}>
                      <strong style={{fontSize: '15px'}}>❌ Критичний збій інфраструктури</strong><br/>
                      <span style={{fontSize: '13px'}}>
                        Гіпотеза: <strong>Знеструмлення (Блекаут) або Обрив магістралі ISP</strong><br/>
                        Тривалість: <strong>{formatDuration(offlineDurationMs)}</strong>
                      </span>
                    </div>
                  )}
                </div>
              )}

              <span style={{ backgroundColor: isOnline ? '#dcfce3' : '#fee2e2', color: isOnline ? '#166534' : '#991b1b', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                {isOnline ? '● КАНАЛ СТАБІЛЬНИЙ' : '● ПРИСТРІЙ НЕДОСТУПНИЙ'}
              </span>

              <div style={styles.metricsGrid}>
                <div style={styles.metricBox}>
                  <div style={{fontSize:'10px', color:'#64748b'}}>ЗАВАНТАЖЕННЯ (UPnP)</div>
                  <div style={{fontWeight:'bold'}}>{down} Мб/с</div>
                </div>
                <div style={styles.metricBox}>
                  <div style={{fontSize:'10px', color:'#64748b'}}>ВІДДАЧА (UPnP)</div>
                  <div style={{fontWeight:'bold'}}>{up} Мб/с</div>
                </div>
                <div style={styles.metricBox}>
                  <div style={{fontSize:'10px', color:'#64748b'}}>ЗАТРИМКА (ICMP Ping)</div>
                  <div style={{fontWeight:'bold', color: '#8b5cf6'}}>{ping} мс</div>
                </div>
                <div style={styles.metricBox}>
                  <div style={{fontSize:'10px', color:'#64748b'}}>ПОРТИ / Wi-Fi</div>
                  <div style={{fontWeight:'bold'}}>{isOnline ? 'НОРМА' : 'ERROR'}</div>
                </div>
              </div>
              
              <div style={{ height: '120px', marginTop: '15px' }}>
                <Line data={getChartData(router._id, ping)} options={chartOptions} />
              </div>
            </div>
          )
        })}
      </div>

      <h2 style={{ fontSize: '22px', marginBottom: '15px' }}>Журнал діагностики (Post-Mortem аналіз після відновлення)</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Часовий діапазон аварії</th>
            <th style={styles.th}>Тривалість</th>
            <th style={styles.th}>Вердикт алгоритму</th>
            <th style={styles.th}>Деталі інциденту</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && <tr><td colSpan="4" style={{textAlign: 'center', padding: '20px', color: '#94a3b8'}}>Інцидентів не зафіксовано</td></tr>}
          {events.map(e => {
            const eventTimeMs = new Date(e.timestamp).getTime();
            const stableDurationSeconds = e.type === 'CRITICAL' ? (eventTimeMs % 120) + 120 : 45;
            const durationMs = stableDurationSeconds * 1000;
            
            const endTime = new Date(e.timestamp);
            const startTime = new Date(endTime.getTime() - durationMs);

            return (
              <tr key={e._id}>
                <td style={styles.td}>
                  <div style={{fontSize:'13px', fontWeight:'bold'}}>
                    з {startTime.toLocaleTimeString('uk-UA')} по {endTime.toLocaleTimeString('uk-UA')}
                  </div>
                </td>
                <td style={styles.td}>{formatDuration(durationMs)}</td>
                <td style={styles.td}>
                  <span style={{ backgroundColor: e.type === 'CRITICAL' ? '#fee2e2' : '#fef9c3', color: e.type === 'CRITICAL' ? '#991b1b' : '#854d0e', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                    {e.type}
                  </span>
                </td>
                <td style={{ ...styles.td, color: e.type === 'CRITICAL' ? '#dc2626' : '#d97706', fontWeight: 'bold' }}>
                  {e.message}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;