const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

async function request(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const api = {
  farms: () => request('/farms'),

  readings: (farmId, limit = 120) =>
    request(`/readings?farm_id=${farmId}&limit=${limit}`),

  alerts: (farmId, limit = 50) =>
    request(`/alerts?farm_id=${farmId}&limit=${limit}`),

  thresholds: (farmId) =>
    request(`/thresholds/latest?farm_id=${farmId}`),

  // ✅ FIX: pass farm_id
  metrics: (farmId) =>
    request(`/metrics/latest?farm_id=${farmId}`)
};
