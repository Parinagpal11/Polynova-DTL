import { all, run } from './db.js';

/*
Strict mapping: ONE event type maps to ONE metric
This prevents event duplication in evaluation
*/
const EVENT_TO_METRIC = {
  cold_shock: 'temp_f',
  heat_stress: 'temp_f',
  humidity_anomaly: 'rh_pct',
  irrigation_failure: 'soil_moisture_pct',
  recovery_event: 'soil_moisture_pct'
};

/*
Evaluate one experiment for one farm + window
*/
export async function evaluateExperiment({
  experimentId,
  farmId,
  lookbackHours
}) {
  const endRow = await all(
    `SELECT MAX(ts) AS max_ts FROM readings WHERE farm_id = ?`,
    [farmId]
  );

  const endTs = endRow?.[0]?.max_ts;
  if (!endTs) {
    throw new Error(`No readings found for farm_id=${farmId}`);
  }

  const endTime = new Date(endTs);
  const startTime = new Date(
    endTime.getTime() - lookbackHours * 3600 * 1000
  );

  /* ---------- Load data ---------- */

  const events = await all(
    `SELECT id, start_ts, end_ts, event_type
     FROM events_ground_truth
     WHERE farm_id = ?
       AND start_ts <= ?
       AND end_ts >= ?`,
    [farmId, endTime.toISOString(), startTime.toISOString()]
  );

  const alerts = await all(
    `SELECT id, ts, metric
     FROM alerts
     WHERE farm_id = ?
       AND ts BETWEEN ? AND ?
       AND experiment_id = ?`,
    [
      farmId,
      startTime.toISOString(),
      endTime.toISOString(),
      experimentId
    ]
  );

  /* ---------- Evaluation ---------- */

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let leadTimes = [];

  const matchedEventIds = new Set();

  for (const ev of events) {
    const expectedMetric = EVENT_TO_METRIC[ev.event_type];
    if (!expectedMetric) continue;

    const evStart = new Date(ev.start_ts);
    const evEnd = new Date(ev.end_ts);

    // Find earliest alert matching BOTH time and metric
    const matchingAlerts = alerts
      .filter(
        (a) =>
          a.metric === expectedMetric &&
          new Date(a.ts) >= evStart &&
          new Date(a.ts) <= evEnd
      )
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    if (matchingAlerts.length > 0) {
      const firstAlert = matchingAlerts[0];
      matchedEventIds.add(ev.id);
      tp += 1;

      const leadMin =
        (new Date(firstAlert.ts) - evStart) / 60000;
      if (leadMin >= 0) leadTimes.push(leadMin);
    } else {
      fn += 1;
    }
  }

  // False positives = alerts not used to match any event
  const usedAlertIds = new Set();

  for (const ev of events) {
    const expectedMetric = EVENT_TO_METRIC[ev.event_type];
    const evStart = new Date(ev.start_ts);
    const evEnd = new Date(ev.end_ts);

    alerts.forEach((a) => {
      if (
        a.metric === expectedMetric &&
        new Date(a.ts) >= evStart &&
        new Date(a.ts) <= evEnd
      ) {
        usedAlertIds.add(a.id);
      }
    });
  }

  alerts.forEach((a) => {
    if (!usedAlertIds.has(a.id)) fp += 1;
  });

  /* ---------- Metrics ---------- */

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const falseAlertRate =
    alerts.length > 0 ? fp / alerts.length : 0;
  const missRate = tp + fn > 0 ? fn / (tp + fn) : 0;

  const avgLeadTime =
    leadTimes.length > 0
      ? leadTimes.reduce((a, b) => a + b, 0) /
        leadTimes.length
      : 0;

  const alertsPerDay =
    alerts.length / Math.max(lookbackHours / 24, 1);

  /* ---------- Persist ---------- */

  await run(
    `INSERT INTO metrics
     (experiment_id, farm_id, period_start, period_end,
      false_alert_rate, miss_rate, precision, recall,
      lead_time_min, alerts_per_day, tp_count, fp_count, fn_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      experimentId,
      farmId,
      startTime.toISOString(),
      endTime.toISOString(),
      falseAlertRate,
      missRate,
      precision,
      recall,
      avgLeadTime,
      alertsPerDay,
      tp,
      fp,
      fn
    ]
  );

  return {
    experiment_id: experimentId,
    tp,
    fp,
    fn,
    precision,
    recall,
    false_alert_rate: falseAlertRate,
    miss_rate: missRate,
    lead_time_min: avgLeadTime,
    alerts_per_day: alertsPerDay
  };
}
