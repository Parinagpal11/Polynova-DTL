import { all, get, run } from './db.js';
import { SAFETY_BOUNDS, clamp, blendStep } from './safetyLayer.js';

const WINDOW_HOURS = 24;
const Q_LOW = 0.15;
const Q_HIGH = 0.85;
const BAND_MARGIN = {
  temp_f: 1.0,
  rh_pct: 2.0,
  soil_moisture_pct: 1.5
};

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export async function recomputeDynamicThresholds() {
  const farms = await all('SELECT farm_id FROM farms');
  const now = new Date().toISOString();
  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  for (const farm of farms) {
    const rows = await all(
      `SELECT temp_f, rh_pct, soil_moisture_pct
       FROM readings
       WHERE farm_id = ? AND ts >= ?`,
      [farm.farm_id, since]
    );

    if (rows.length < 20) continue;

    const metrics = {
      temp_f: rows.map((r) => r.temp_f),
      rh_pct: rows.map((r) => r.rh_pct),
      soil_moisture_pct: rows.map((r) => r.soil_moisture_pct)
    };

    for (const metric of Object.keys(metrics)) {
      const values = metrics[metric];
      const lowCandidate = quantile(values, Q_LOW);
      const highCandidate = quantile(values, Q_HIGH);
      const bounds = SAFETY_BOUNDS[metric];
      const margin = BAND_MARGIN[metric] ?? 0;

      let low = clamp(lowCandidate - margin, bounds.low, bounds.high);
      let high = clamp(highCandidate + margin, bounds.low, bounds.high);
      if (low > high) {
        const mid = (low + high) / 2;
        low = mid - 1;
        high = mid + 1;
      }

      const prev = await get(
        `SELECT low, high FROM dynamic_thresholds
         WHERE farm_id = ? AND metric = ?
         ORDER BY updated_at DESC LIMIT 1`,
        [farm.farm_id, metric]
      );

      if (prev) {
        low = blendStep(prev.low, low, 2);
        high = blendStep(prev.high, high, 2);
      }

      await run(
        `INSERT INTO dynamic_thresholds (farm_id, metric, low, high, method, window_hours, updated_at)
         VALUES (?, ?, ?, ?, 'rolling_quantile', ?, ?)`,
        [farm.farm_id, metric, low, high, WINDOW_HOURS, now]
      );
    }
  }
}

export async function getLatestDynamicThresholdMap(farmId) {
  const rows = await all(
    `SELECT metric, low, high FROM dynamic_thresholds dt
     WHERE farm_id = ?
       AND updated_at = (
         SELECT MAX(updated_at) FROM dynamic_thresholds dt2
         WHERE dt2.farm_id = dt.farm_id AND dt2.metric = dt.metric
       )`,
    [farmId]
  );

  const map = {};
  for (const row of rows) map[row.metric] = { low: row.low, high: row.high };
  return map;
}
