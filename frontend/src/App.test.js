import { render, screen, waitFor } from '@testing-library/react';
import App, { formatDuration } from './App';

jest.mock('axios', () => ({
  get: (url) => {
    if (url.endsWith('/api/routers')) return Promise.resolve({ data: [] });
    if (url.endsWith('/api/ml/info')) return Promise.resolve({ data: { version: '1.0.0', metrics: { f1_macro: 0.967 } } });
    if (url.endsWith('/api/events')) return Promise.resolve({ data: [{
      _id: '1', routerName: 'Кав\'ярня', type: 'CRITICAL', cause: 'POWER_OUTAGE', method: 'ml', confidence: 0.93,
      downtimeSeconds: 3725, startedAt: '2026-10-20T10:00:00Z', endedAt: '2026-10-20T11:02:05Z', explanation: 'Тестове пояснення',
    }] });
    return Promise.resolve({ data: [] });
  },
  post: () => Promise.resolve({ data: {} }),
  delete: () => Promise.resolve({ data: {} }),
}));

test('відображає заголовок панелі моніторингу', () => {
  render(<App />);
  expect(screen.getByText(/Центр моніторингу SOHO/i)).toBeInTheDocument();
});

test('журнал показує реальну тривалість з БД і вердикт ML', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Знеструмлення')).toBeInTheDocument());
  expect(screen.getByText('1 год 2 хв 5 сек')).toBeInTheDocument();
  expect(screen.getByText(/ML-модель, 93%/)).toBeInTheDocument();
});

test('formatDuration коректно форматує граничні значення', () => {
  expect(formatDuration(0)).toBe('0 сек');
  expect(formatDuration(59)).toBe('59 сек');
  expect(formatDuration(60)).toBe('1 хв 0 сек');
  expect(formatDuration(3600)).toBe('1 год 0 сек');
  expect(formatDuration(-5)).toBe('0 сек');
});
