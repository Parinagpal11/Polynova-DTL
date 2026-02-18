import { all } from './db.js';

export async function getStaticThresholdMap(farmId) {
  const rows = await all(
    `SELECT metric, low, high FROM static_thresholds
     WHERE farm_id = ?
     ORDER BY effective_from DESC`,
    [farmId]
  );

  const map = {};
  for (const row of rows) {
    if (!map[row.metric]) map[row.metric] = { low: row.low, high: row.high };
  }
  return map;
}
