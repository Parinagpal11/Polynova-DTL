import 'dotenv/config';
import { all, get, migrateAndSeed, run } from './db.js';

function clampIndex(i, n) {
  if (n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, i));
}

function addMinutesIso(ts, minutes) {
  return new Date(new Date(ts).getTime() + minutes * 60000).toISOString();
}

function medianMinutes(readings) {
  if (readings.length < 2) return 10;
  const diffs = [];
  for (let i = 1; i < readings.length; i += 1) {
    diffs.push((new Date(readings[i].ts) - new Date(readings[i - 1].ts)) / 60000);
  }
  diffs.sort((a, b) => a - b);
  return Math.max(1, diffs[Math.floor(diffs.length / 2)] || 10);
}

function findMinMetricIndex(readings, metric, startIdx, endIdx) {
  let best = clampIndex(startIdx, readings.length);
  const end = clampIndex(endIdx, readings.length);
  for (let i = best + 1; i <= end; i += 1) {
    if (readings[i]?.[metric] < readings[best]?.[metric]) best = i;
  }
  return best;
}

function findMaxMetricIndex(readings, metric, startIdx, endIdx) {
  let best = clampIndex(startIdx, readings.length);
  const end = clampIndex(endIdx, readings.length);
  for (let i = best + 1; i <= end; i += 1) {
    if (readings[i]?.[metric] > readings[best]?.[metric]) best = i;
  }
  return best;
}

function pickIrrigationFailureWindow(readings, stepMin, startIdx, endIdx) {
  const start = clampIndex(startIdx, readings.length);
  const end = clampIndex(endIdx, readings.length);
  const segment = readings.slice(start, end + 1);

  const minPoints = Math.max(2, Math.round(120 / stepMin)); // 2h
  const maxPoints = Math.max(minPoints + 1, Math.round(240 / stepMin)); // 4h

  let bestStart = 0;
  let bestEnd = Math.min(minPoints, segment.length - 1);
  let bestDrop = Infinity;

  for (let i = 0; i < segment.length - minPoints; i += 1) {
    for (let p = minPoints; p <= maxPoints && i + p < segment.length; p += 1) {
      const a = segment[i]?.soil_moisture_pct;
      const b = segment[i + p]?.soil_moisture_pct;
      if (a == null || b == null) continue;
      const drop = b - a; // most negative = biggest drop
      if (drop < bestDrop) {
        bestDrop = drop;
        bestStart = i;
        bestEnd = i + p;
      }
    }
  }

  return { startIdx: start + bestStart, endIdx: start + bestEnd };
}

function enforceNonOverlap(events, minTs, maxTs) {
  const sorted = [...events].sort((a, b) => new Date(a.startTs) - new Date(b.startTs));
  const minMs = new Date(minTs).getTime();
  const maxMs = new Date(maxTs).getTime();

  for (let i = 0; i < sorted.length; i += 1) {
    let start = new Date(sorted[i].startTs).getTime();
    let end = new Date(sorted[i].endTs).getTime();
    const dur = Math.max(5 * 60000, end - start); // at least 5 min

    if (i > 0) {
      const prevEnd = new Date(sorted[i - 1].endTs).getTime();
      if (start <= prevEnd) {
        start = prevEnd + 5 * 60000;
        end = start + dur;
      }
    }

    // clamp inside window
    if (start < minMs) {
      start = minMs;
      end = start + dur;
    }
    if (end > maxMs) {
      end = maxMs;
      start = Math.max(minMs, end - dur);
    }

    sorted[i].startTs = new Date(start).toISOString();
    sorted[i].endTs = new Date(end).toISOString();
  }

  return sorted;
}

async function main() {
  const farmId = process.argv[2] || 'farm_global_2';
  const lookbackHours = Number(process.argv[3] || 24);

  await migrateAndSeed();

  // ✅ anchor to data end (same fix as run-experiments)
  const maxRow = await get(
    `SELECT MAX(ts) AS max_ts
     FROM readings
     WHERE farm_id = ?`,
    [farmId]
  );
  if (!maxRow?.max_ts) throw new Error('No readings found for this farm. Import/generate readings first.');

  const endBound = new Date(maxRow.max_ts);
  const startBound = new Date(endBound.getTime() - lookbackHours * 3600 * 1000);

  const readings = await all(
    `SELECT ts, temp_f, rh_pct, soil_moisture_pct
     FROM readings
     WHERE farm_id = ? AND ts BETWEEN ? AND ?
     ORDER BY ts ASC`,
    [farmId, startBound.toISOString(), endBound.toISOString()]
  );

  if (readings.length < 60) {
    throw new Error(
      `Not enough readings (${readings.length}). Need >= 60 so dynamic thresholds/history can exist. Import more data or increase lookback_hours.`
    );
  }

  // wipe existing GT for this farm
  await run('DELETE FROM events_ground_truth WHERE farm_id = ?', [farmId]);

  const n = readings.length;
  const stepMin = medianMinutes(readings);

  const minTs = readings[0].ts;
  const maxTs = readings[n - 1].ts;

  // ✅ Critical: seed events AFTER enough history exists
  // dynamic logic needs history; so never seed in first ~25% of window
  const safeStart = clampIndex(Math.floor(n * 0.30), n);
  const safeEnd = clampIndex(Math.floor(n * 0.95), n);

  const coldIdx = findMinMetricIndex(readings, 'temp_f', safeStart, safeEnd);
  const heatIdx = findMaxMetricIndex(readings, 'temp_f', safeStart, safeEnd);
  const humidityIdx = findMaxMetricIndex(readings, 'rh_pct', safeStart, safeEnd);

  const irrigation = pickIrrigationFailureWindow(readings, stepMin, safeStart, safeEnd);

  // recovery: biggest positive jump after irrigation end
  let recoveryIdx = clampIndex(irrigation.endIdx + 1, n);
  let bestJump = -Infinity;
  const recoverySearchEnd = Math.min(n - 1, irrigation.endIdx + Math.max(2, Math.round(240 / stepMin))); // up to 4h
  for (let i = Math.max(1, irrigation.endIdx + 1); i <= recoverySearchEnd; i += 1) {
    const a = readings[i - 1]?.soil_moisture_pct;
    const b = readings[i]?.soil_moisture_pct;
    if (a == null || b == null) continue;
    const jump = b - a;
    if (jump > bestJump) {
      bestJump = jump;
      recoveryIdx = i;
    }
  }

  const rawEvents = [
    {
      eventType: 'cold_shock',
      severity: 'high',
      startTs: readings[coldIdx].ts,
      endTs: addMinutesIso(readings[coldIdx].ts, 20)
    },
    {
      eventType: 'heat_stress',
      severity: 'high',
      startTs: readings[heatIdx].ts,
      endTs: addMinutesIso(readings[heatIdx].ts, 25)
    },
    {
      eventType: 'humidity_anomaly',
      severity: 'medium',
      startTs: readings[humidityIdx].ts,
      endTs: addMinutesIso(readings[humidityIdx].ts, 20)
    },
    {
      eventType: 'irrigation_failure',
      severity: 'high',
      startTs: readings[irrigation.startIdx].ts,
      endTs: readings[irrigation.endIdx].ts
    },
    {
      eventType: 'recovery_event',
      severity: 'medium',
      startTs: readings[recoveryIdx].ts,
      endTs: addMinutesIso(readings[recoveryIdx].ts, 45)
    }
  ];

  const events = enforceNonOverlap(rawEvents, minTs, maxTs);

  for (const ev of events) {
    await run(
      `INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
       VALUES (?, ?, ?, ?, ?)`,
      [farmId, ev.startTs, ev.endTs, ev.eventType, ev.severity]
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        farm_id: farmId,
        lookback_hours: lookbackHours,
        inserted: events.length,
        events
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
