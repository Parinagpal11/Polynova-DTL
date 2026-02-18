import fs from 'fs';
import path from 'path';
import { get, run } from './db.js';

function parseCsvLine(line, delimiter = ',') {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cToF(celsius) {
  return (celsius * 9) / 5 + 32;
}

function normalizeTimestamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function ensureFarmExists(farmId) {
  const farm = await get('SELECT farm_id FROM farms WHERE farm_id = ?', [farmId]);
  if (!farm) throw new Error(`farm_id not found: ${farmId}`);
}

function mapped(row, map, key) {
  const col = map[key];
  return col ? row[col] : null;
}

export async function importReadingsCsv({
  filePath,
  farmId,
  mapping,
  hasHeader = true,
  delimiter = ',',
  tempUnit = 'f'
}) {
  if (!filePath || !farmId) throw new Error('filePath and farmId are required');
  await ensureFarmExists(farmId);

  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);

  const raw = fs.readFileSync(abs, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) throw new Error('empty csv');

  const headers = hasHeader ? parseCsvLine(lines[0], delimiter) : null;
  const start = hasHeader ? 1 : 0;

  const colMap = {};
  if (headers) {
    for (const h of headers) colMap[h] = h;
  }

  const stats = { inserted: 0, skipped: 0, errors: 0 };

  for (let i = start; i < lines.length; i += 1) {
    const parts = parseCsvLine(lines[i], delimiter);
    const row = {};
    if (headers) {
      headers.forEach((h, idx) => {
        row[h] = parts[idx] ?? '';
      });
    } else {
      parts.forEach((v, idx) => {
        row[String(idx)] = v;
      });
    }

    const tsRaw = mapped(row, mapping || colMap, 'timestamp') ?? row.timestamp;
    const tempRaw = mapped(row, mapping || colMap, 'temp') ?? row.temp;
    const rhRaw = mapped(row, mapping || colMap, 'rh') ?? row.rh;
    const soilRaw = mapped(row, mapping || colMap, 'soil_moisture') ?? row.soil_moisture;
    const tankRaw = mapped(row, mapping || colMap, 'tank') ?? row.tank;

    const ts = normalizeTimestamp(tsRaw);
    let temp = toNumber(tempRaw);
    const rh = toNumber(rhRaw);
    const soil = toNumber(soilRaw);
    const tank = toNumber(tankRaw);

    if (tempUnit.toLowerCase() === 'c' && temp !== null) temp = cToF(temp);

    if (!ts || temp === null || rh === null || soil === null) {
      stats.skipped += 1;
      continue;
    }

    try {
      await run(
        `INSERT INTO readings (farm_id, ts, temp_f, rh_pct, soil_moisture_pct, tank_pct, sensor_health)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [farmId, ts, temp, rh, soil, tank]
      );
      stats.inserted += 1;
    } catch (_err) {
      stats.errors += 1;
    }
  }

  return stats;
}

function clamp(v, low, high) {
  return Math.max(low, Math.min(high, v));
}

function deriveSoilMoisture({ tempC, rh, precipitationMm }) {
  const rainBoost = (precipitationMm || 0) * 2.4;
  const evapPenalty = Math.max(0, (tempC - 20) * 0.7);
  const humidityBoost = (rh - 50) * 0.15;
  const est = 38 + rainBoost + humidityBoost - evapPenalty;
  return clamp(est, 10, 85);
}

function deriveTankPct({ precipitationMm, previousTank }) {
  const inflow = (precipitationMm || 0) * 0.8;
  const outflow = 0.35;
  const next = (previousTank ?? 70) + inflow - outflow;
  return clamp(next, 0, 100);
}

export async function importOpenMeteoArchive({
  farmId,
  latitude,
  longitude,
  startDate,
  endDate,
  timezone = 'UTC'
}) {
  if (!farmId) throw new Error('farmId is required');
  if (latitude === undefined || longitude === undefined) {
    throw new Error('latitude and longitude are required');
  }
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');
  await ensureFarmExists(farmId);

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('timezone', timezone);
  url.searchParams.set(
    'hourly',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation'
    ].join(',')
  );

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`open-meteo request failed: ${response.status}`);
  }
  const payload = await response.json();
  const hourly = payload?.hourly;
  if (!hourly?.time?.length) throw new Error('open-meteo returned no hourly data');

  const stats = { inserted: 0, skipped: 0, errors: 0 };
  let tankPct = 70;

  for (let i = 0; i < hourly.time.length; i += 1) {
    const ts = normalizeTimestamp(hourly.time[i]);
    const tempC = toNumber(hourly.temperature_2m?.[i]);
    const rh = toNumber(hourly.relative_humidity_2m?.[i]);
    const precipitationMm = toNumber(hourly.precipitation?.[i]) ?? 0;

    if (!ts || tempC === null || rh === null) {
      stats.skipped += 1;
      continue;
    }

    const tempF = cToF(tempC);
    const soil = deriveSoilMoisture({ tempC, rh, precipitationMm });
    tankPct = deriveTankPct({ precipitationMm, previousTank: tankPct });

    try {
      await run(
        `INSERT INTO readings (farm_id, ts, temp_f, rh_pct, soil_moisture_pct, tank_pct, sensor_health)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [farmId, ts, tempF, rh, soil, tankPct]
      );
      stats.inserted += 1;
    } catch (_err) {
      stats.errors += 1;
    }
  }

  return stats;
}
