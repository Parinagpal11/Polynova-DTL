import 'dotenv/config';
import { all, get, migrateAndSeed, run } from './db.js';

const LEAD_WINDOW_MIN = 30;

// Safety bounds (hard guardrails)
const SAFETY_BOUNDS = {
  temp_f: { low: 35, high: 95 },
  rh_pct: { low: 30, high: 95 },
  soil_moisture_pct: { low: 20, high: 60 }
};

const METRICS = ['temp_f', 'rh_pct', 'soil_moisture_pct'];

// Which event maps to which metric for scoring
const EVENT_METRIC_MAP = {
  heat_stress: 'temp_f',
  cold_shock: 'temp_f',
  humidity_anomaly: 'rh_pct',
  irrigation_failure: 'soil_moisture_pct',
  recovery_event: 'soil_moisture_pct'
};

function clamp(v, low, high) {
  return Math.max(low, Math.min(high, v));
}

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

function ema(prev, next, alpha) {
  if (prev == null) return next;
  return alpha * next + (1 - alpha) * prev;
}

// returns minutes(a - b)
function minutesBetween(a, b) {
  return (new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

function eventMappedMetric(eventType) {
  return EVENT_METRIC_MAP[eventType] || null;
}

function intersects(alert, event) {
  const requiredMetric = eventMappedMetric(event.event_type);
  if (!requiredMetric) return false;
  if (alert.metric !== requiredMetric) return false;

  const alertTs = new Date(alert.ts).getTime();
  const startTs = new Date(event.start_ts).getTime();
  const endTs = new Date(event.end_ts).getTime();
  const leadStart = startTs - LEAD_WINDOW_MIN * 60 * 1000;

  return alertTs >= leadStart && alertTs <= endTs;
}

async function ensureExperiment(experimentId, name, method, paramsJson) {
  const existing = await get('SELECT experiment_id FROM experiments WHERE experiment_id = ?', [experimentId]);
  if (existing) return;

  await run(
    `INSERT INTO experiments (experiment_id, name, method, params_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [experimentId, name, method, paramsJson, new Date().toISOString()]
  );
}

async function getStaticThresholdMap(farmId) {
  const rows = await all(
    `SELECT metric, low, high
     FROM static_thresholds
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

function compareAgainstThreshold(value, threshold) {
  if (!threshold) return false;
  if (threshold.low !== null && threshold.low !== undefined && value < threshold.low) return true;
  if (threshold.high !== null && threshold.high !== undefined && value > threshold.high) return true;
  return false;
}

/**
 * Dynamic threshold that:
 * - recomputes only every thresholdUpdateEveryMin
 * - smooths thresholds with EMA (emaAlpha)
 * - uses per-metric quantiles + margins with safety bounds
 */
function dynamicThresholdFor(readings, idx, metric, config, state) {
  const currentTsMs = new Date(readings[idx].ts).getTime();
  const windowHours = config.windowHours ?? 24;
  const fromTsMs = currentTsMs - windowHours * 3600 * 1000;

  const updateEveryMin = config.thresholdUpdateEveryMin ?? 30;
  const lastUpdateMs = state.lastThresholdUpdateMs?.[metric] ?? null;

  // Return cached threshold if not time to update
  if (lastUpdateMs != null && currentTsMs - lastUpdateMs < updateEveryMin * 60 * 1000) {
    return state.cachedThresholds?.[metric] ?? null;
  }

  // Build history window
  const history = [];
  for (let i = 0; i <= idx; i += 1) {
    const tMs = new Date(readings[i].ts).getTime();
    if (tMs >= fromTsMs && tMs <= currentTsMs) history.push(readings[i][metric]);
  }

  const minHistoryPoints = config.minHistoryPoints ?? 30;
  if (history.length < minHistoryPoints) return null;

  const qLow = config.q?.[metric]?.low ?? config.qLow;
  const qHigh = config.q?.[metric]?.high ?? config.qHigh;
  const margin = config.margins?.[metric] ?? config.margin;

  const b = SAFETY_BOUNDS[metric];
  const lowRaw = clamp(quantile(history, qLow) - margin, b.low, b.high);
  const highRaw = clamp(quantile(history, qHigh) + margin, b.low, b.high);

  // EMA smoothing
  const alpha = config.emaAlpha ?? 0.35;
  const prev = state.emaThresholds?.[metric] ?? { low: null, high: null };
  const low = ema(prev.low, lowRaw, alpha);
  const high = ema(prev.high, highRaw, alpha);

  // Cache results
  state.lastThresholdUpdateMs = state.lastThresholdUpdateMs || {};
  state.cachedThresholds = state.cachedThresholds || {};
  state.emaThresholds = state.emaThresholds || {};

  state.lastThresholdUpdateMs[metric] = currentTsMs;
  state.cachedThresholds[metric] = { low, high };
  state.emaThresholds[metric] = { low, high };

  return { low, high };
}

/**
 * Simulates alerts with:
 * - per-metric minConsecutiveBreaches
 * - per-metric cooldownMin
 */
function simulateAlerts({ readings, staticMap, config }) {
  const alerts = [];
  const streak = new Map(); // metric -> consecutive breaches
  const lastAlertMs = new Map(); // metric -> last alert timestamp ms
  const state = {}; // threshold cache + EMA state

  const cooldownMinDefault = config.cooldownMin ?? 45;

  for (let i = 0; i < readings.length; i += 1) {
    const r = readings[i];
    const tsMs = new Date(r.ts).getTime();

    for (const metric of METRICS) {
      let threshold = null;
      if (config.kind === 'static') {
        threshold = staticMap[metric];
      } else {
        threshold = dynamicThresholdFor(readings, i, metric, config, state) || staticMap[metric];
      }

      const breach = compareAgainstThreshold(r[metric], threshold);

      const needed = config.minConsecutiveByMetric?.[metric] ?? config.minConsecutiveBreaches ?? 1;

      const next = breach ? (streak.get(metric) || 0) + 1 : 0;
      streak.set(metric, next);

      if (!breach || next < needed) continue;

      const cooldownMin = config.cooldownByMetric?.[metric] ?? cooldownMinDefault;
      const lastMs = lastAlertMs.get(metric);

      if (lastMs != null && tsMs - lastMs < cooldownMin * 60 * 1000) continue;

      alerts.push({ ts: r.ts, metric });
      lastAlertMs.set(metric, tsMs);
    }
  }

  return alerts;
}

/**
 * ✅ Correct scoring:
 * - Ignore unmapped events (don’t count them as FN)
 * - TP is 1 per event (earliest matching alert), not “every alert inside window”
 * - FP is alerts that match no mapped event
 * - lead_time_min is positive when alert happens before event
 */
function score({ alerts, events, periodHours }) {
  const mappedEvents = events.filter((e) => eventMappedMetric(e.event_type));

  // Count FN/TP per event (one alert max)
  let tpCount = 0;
  let fnCount = 0;
  const leadTimes = [];

  // Track which alerts got used to “claim” an event (optional but keeps FP clean)
  const usedAlertIdx = new Set();

  for (const ev of mappedEvents) {
    // all matching alerts + keep earliest
    const matches = [];
    for (let i = 0; i < alerts.length; i += 1) {
      if (intersects(alerts[i], ev)) matches.push({ i, a: alerts[i] });
    }

    if (!matches.length) {
      fnCount += 1;
      continue;
    }

    matches.sort((x, y) => new Date(x.a.ts) - new Date(y.a.ts));
    const first = matches[0];
    tpCount += 1;
    usedAlertIdx.add(first.i);

    // ✅ lead time: (eventStart - alertTime) => positive when alert comes earlier
    leadTimes.push(minutesBetween(ev.start_ts, first.a.ts));
  }

  // FP: any alert that doesn't intersect any mapped event
  let fpCount = 0;
  for (const a of alerts) {
    const matched = mappedEvents.some((ev) => intersects(a, ev));
    if (!matched) fpCount += 1;
  }

  const noAlerts = alerts.length === 0;
  const noEvents = mappedEvents.length === 0;
  const stablePeriod = noAlerts && noEvents;

  const precision = tpCount + fpCount > 0 ? tpCount / (tpCount + fpCount) : null;
  const recall = tpCount + fnCount > 0 ? tpCount / (tpCount + fnCount) : null;
  const falseAlertRate = tpCount + fpCount > 0 ? fpCount / (tpCount + fpCount) : 0;
  const missRate = tpCount + fnCount > 0 ? fnCount / (tpCount + fnCount) : 0;
  const leadTimeMin = leadTimes.length ? leadTimes.reduce((a, v) => a + v, 0) / leadTimes.length : 0;
  const alertsPerDay = alerts.length / (periodHours / 24);
  const windowLabel = stablePeriod ? 'stable_period' : mappedEvents.length > 0 ? 'event_window' : 'no_event_alert_window';

  return {
    tpCount,
    fpCount,
    fnCount,
    precision,
    recall,
    falseAlertRate,
    missRate,
    leadTimeMin,
    alertsPerDay,
    windowLabel,
    mappedEventCount: mappedEvents.length,
    ignoredEventCount: events.length - mappedEvents.length
  };
}

async function main() {
  const farmId = process.argv[2] || 'farm_global_2';
  const lookbackHours = Number(process.argv[3] || 24);

  await migrateAndSeed();

  // ✅ anchor evaluation window to data (MAX(readings.ts)), not "now"
  const maxRow = await get(
    `SELECT MAX(ts) AS max_ts
     FROM readings
     WHERE farm_id = ?`,
    [farmId]
  );

  if (!maxRow?.max_ts) {
    throw new Error('No readings found for this farm. Import/generate data first.');
  }

  const end = new Date(maxRow.max_ts);
  const start = new Date(end.getTime() - lookbackHours * 3600 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const readings = await all(
    `SELECT ts, temp_f, rh_pct, soil_moisture_pct
     FROM readings
     WHERE farm_id = ? AND ts BETWEEN ? AND ?
     ORDER BY ts ASC`,
    [farmId, startIso, endIso]
  );

  if (readings.length < 30) {
    throw new Error('Not enough readings in selected window. Increase lookback or import more data.');
  }

  const events = await all(
    `SELECT id, start_ts, end_ts, event_type, severity
     FROM events_ground_truth
     WHERE farm_id = ? AND end_ts >= ? AND start_ts <= ?
     ORDER BY start_ts ASC`,
    [farmId, startIso, endIso]
  );

  const staticMap = await getStaticThresholdMap(farmId);
  const periodHours = Math.max(1, (end - start) / (3600 * 1000));

  const cfg_v2 = {
    experimentId: 'exp_dynamic_quantile_v2',
    name: 'Dynamic Quantile (Cooldown + EMA + Wider)',
    method: 'rolling_quantile_ema_cooldown',
    kind: 'dynamic',
    q: {
      temp_f: { low: 0.10, high: 0.90 },
      rh_pct: { low: 0.10, high: 0.90 },
      soil_moisture_pct: { low: 0.10, high: 0.90 }
    },
    margins: {
      temp_f: 2.0,
      rh_pct: 3.0,
      soil_moisture_pct: 2.0
    },
    cooldownByMetric: {
      temp_f: 30,
      rh_pct: 30,
      soil_moisture_pct: 45
    },
    minConsecutiveByMetric: {
      temp_f: 2,
      rh_pct: 2,
      soil_moisture_pct: 1
    },
    windowHours: 24,
    thresholdUpdateEveryMin: 30,
    emaAlpha: 0.35,
    minHistoryPoints: 30
  };

  const cfg_stable = {
    experimentId: 'exp_dynamic_quantile_stable_v2',
    name: 'Dynamic Quantile (Stricter)',
    method: 'rolling_quantile_ema_cooldown_strict',
    kind: 'dynamic',
    q: {
      temp_f: { low: 0.05, high: 0.95 },
      rh_pct: { low: 0.05, high: 0.95 },
      soil_moisture_pct: { low: 0.05, high: 0.95 }
    },
    margins: {
      temp_f: 2.5,
      rh_pct: 4.0,
      soil_moisture_pct: 2.5
    },
    cooldownByMetric: {
      temp_f: 45,
      rh_pct: 45,
      soil_moisture_pct: 60
    },
    minConsecutiveByMetric: {
      temp_f: 3,
      rh_pct: 3,
      soil_moisture_pct: 2
    },
    windowHours: 24,
    thresholdUpdateEveryMin: 60,
    emaAlpha: 0.25,
    minHistoryPoints: 30
  };

  const configs = [
    {
      experimentId: 'exp_static_v1',
      name: 'Static Baseline',
      method: 'static',
      kind: 'static',
      minConsecutiveBreaches: 1,
      params: { kind: 'static', minConsecutiveBreaches: 1 }
    },
    {
      ...cfg_v2,
      params: {
        kind: 'dynamic',
        q: { temp_f: [0.10, 0.90], rh_pct: [0.10, 0.90], soil_moisture_pct: [0.10, 0.90] },
        margins: cfg_v2.margins,
        cooldownByMetric: cfg_v2.cooldownByMetric,
        minConsecutiveByMetric: cfg_v2.minConsecutiveByMetric,
        windowHours: cfg_v2.windowHours,
        thresholdUpdateEveryMin: cfg_v2.thresholdUpdateEveryMin,
        emaAlpha: cfg_v2.emaAlpha,
        minHistoryPoints: cfg_v2.minHistoryPoints
      }
    },
    {
      ...cfg_stable,
      params: {
        kind: 'dynamic',
        q: { temp_f: [0.05, 0.95], rh_pct: [0.05, 0.95], soil_moisture_pct: [0.05, 0.95] },
        margins: cfg_stable.margins,
        cooldownByMetric: cfg_stable.cooldownByMetric,
        minConsecutiveByMetric: cfg_stable.minConsecutiveByMetric,
        windowHours: cfg_stable.windowHours,
        thresholdUpdateEveryMin: cfg_stable.thresholdUpdateEveryMin,
        emaAlpha: cfg_stable.emaAlpha,
        minHistoryPoints: cfg_stable.minHistoryPoints
      }
    }
  ];

  const out = [];

  for (const cfg of configs) {
    await ensureExperiment(cfg.experimentId, cfg.name, cfg.method, JSON.stringify(cfg.params));

    const alerts = simulateAlerts({ readings, staticMap, config: cfg });

    if (cfg.experimentId === 'exp_dynamic_quantile_v2') {
      console.log('--- DEBUG (exp_dynamic_quantile_v2) ---');
      console.log('Window:', startIso, '->', endIso);
      console.log('Events:', events.length);
      for (const ev of events) console.log(ev.event_type, ev.start_ts, ev.end_ts);

      console.log('Alerts:', alerts.length);
      console.log('First 25 alerts:');
      for (const a of alerts.slice(0, 25)) console.log(a.ts, a.metric);

      console.log('Last 25 alerts:');
      for (const a of alerts.slice(Math.max(0, alerts.length - 25))) console.log(a.ts, a.metric);

      let anyHit = false;
      for (const ev of events) {
        const hit = alerts.some((a) => intersects(a, ev));
        console.log('Event', ev.event_type, 'mapped?', !!eventMappedMetric(ev.event_type), 'hit?', hit);
        if (hit) anyHit = true;
      }
      console.log('Any intersect at all?', anyHit);
      console.log('--- END DEBUG ---');
    }

    const scored = score({ alerts, events, periodHours });

    await run(
      `INSERT INTO metrics (experiment_id, farm_id, period_start, period_end,
       false_alert_rate, miss_rate, precision, recall, lead_time_min,
       tp_count, fp_count, fn_count, alerts_per_day, window_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cfg.experimentId,
        farmId,
        startIso,
        endIso,
        scored.falseAlertRate,
        scored.missRate,
        scored.precision,
        scored.recall,
        scored.leadTimeMin,
        scored.tpCount,
        scored.fpCount,
        scored.fnCount,
        scored.alertsPerDay,
        scored.windowLabel
      ]
    );

    out.push({
      experiment_id: cfg.experimentId,
      tp: scored.tpCount,
      fp: scored.fpCount,
      fn: scored.fnCount,
      precision: scored.precision,
      recall: scored.recall,
      false_alert_rate: scored.falseAlertRate,
      miss_rate: scored.missRate,
      lead_time_min: scored.leadTimeMin,
      alerts_per_day: scored.alertsPerDay,
      window_label: scored.windowLabel,
      mapped_event_count: scored.mappedEventCount,
      ignored_event_count: scored.ignoredEventCount
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        farm_id: farmId,
        lookback_hours: lookbackHours,
        event_count: events.length,
        reading_count: readings.length,
        results: out
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
