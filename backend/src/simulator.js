import { all, run } from './db.js';
import { getStaticThresholdMap } from './staticEngine.js';
import { getLatestDynamicThresholdMap } from './dynamicEngine.js';

const cooldown = new Map();
const breachStreak = new Map();
const COOLDOWN_MS = 5 * 60 * 1000;
const REQUIRED_CONSECUTIVE_BREACHES = 2;

function key(farmId, metric, ruleType) {
  return `${farmId}:${metric}:${ruleType}`;
}

function inCooldown(farmId, metric, ruleType) {
  const k = key(farmId, metric, ruleType);
  const last = cooldown.get(k) || 0;
  return Date.now() - last < COOLDOWN_MS;
}

function stampCooldown(farmId, metric, ruleType) {
  cooldown.set(key(farmId, metric, ruleType), Date.now());
}

function shouldEmitAlert(farmId, metric, ruleType, isBreach) {
  const k = key(farmId, metric, ruleType);
  if (!isBreach) {
    breachStreak.delete(k);
    return false;
  }

  const next = (breachStreak.get(k) || 0) + 1;
  breachStreak.set(k, next);
  return next >= REQUIRED_CONSECUTIVE_BREACHES;
}

function seasonalBaseline(date, farmId) {
  const h = date.getHours();
  const phase = (h / 24) * Math.PI * 2;

  if (farmId.endsWith('1')) {
    return {
      temp_f: 68 + 14 * Math.sin(phase - 0.4),
      rh_pct: 66 + 12 * Math.cos(phase + 0.3),
      soil_moisture_pct: 42 - 8 * Math.sin(phase + 0.2),
      tank_pct: 72 - 3 * Math.sin(phase)
    };
  }

  if (farmId.endsWith('2')) {
    return {
      temp_f: 78 + 16 * Math.sin(phase - 0.3),
      rh_pct: 40 + 10 * Math.cos(phase + 0.4),
      soil_moisture_pct: 34 - 10 * Math.sin(phase + 0.1),
      tank_pct: 64 - 4 * Math.sin(phase + 0.2)
    };
  }

  if (farmId.endsWith('3')) {
    return {
      temp_f: 82 + 10 * Math.sin(phase - 0.5),
      rh_pct: 80 + 9 * Math.cos(phase + 0.2),
      soil_moisture_pct: 46 - 6 * Math.sin(phase + 0.4),
      tank_pct: 70 - 2 * Math.sin(phase)
    };
  }

  return {
    temp_f: 58 + 18 * Math.sin(phase - 0.6),
    rh_pct: 62 + 14 * Math.cos(phase + 0.1),
    soil_moisture_pct: 40 - 9 * Math.sin(phase + 0.3),
    tank_pct: 74 - 3 * Math.sin(phase - 0.1)
  };
}

function randomNoise(scale = 1) {
  return (Math.random() - 0.5) * 2 * scale;
}

function injectOccasionalStress(values) {
  const p = Math.random();
  if (p < 0.03) {
    values.temp_f += 15;
    values.rh_pct += 10;
  } else if (p > 0.97) {
    values.temp_f -= 18;
  }

  if (Math.random() < 0.08) {
    values.soil_moisture_pct -= 8;
  }

  return values;
}

function compareAgainstThreshold(value, threshold) {
  if (!threshold) return false;
  if (threshold.low !== null && threshold.low !== undefined && value < threshold.low) return true;
  if (threshold.high !== null && threshold.high !== undefined && value > threshold.high) return true;
  return false;
}

async function createAlert(farmId, metric, ruleType, value, threshold) {
  if (inCooldown(farmId, metric, ruleType)) return;

  const severity = metric === 'temp_f' ? 'high' : 'medium';
  const msg = `${ruleType.toUpperCase()} breach on ${metric}: value=${value.toFixed(2)} limits=[${threshold.low ?? '-inf'}, ${threshold.high ?? 'inf'}]`;

  await run(
    `INSERT INTO alerts (farm_id, ts, metric, severity, rule_type, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [farmId, new Date().toISOString(), metric, severity, ruleType, msg]
  );

  stampCooldown(farmId, metric, ruleType);
}

export async function tickSimulator() {
  const farms = await all('SELECT farm_id FROM farms');
  for (const farm of farms) {
    const base = seasonalBaseline(new Date(), farm.farm_id);
    const values = injectOccasionalStress({
      temp_f: base.temp_f + randomNoise(2.5),
      rh_pct: base.rh_pct + randomNoise(3.5),
      soil_moisture_pct: base.soil_moisture_pct + randomNoise(2),
      tank_pct: base.tank_pct + randomNoise(1.5)
    });

    values.rh_pct = Math.max(15, Math.min(99, values.rh_pct));
    values.soil_moisture_pct = Math.max(5, Math.min(90, values.soil_moisture_pct));
    values.tank_pct = Math.max(0, Math.min(100, values.tank_pct));

    await run(
      `INSERT INTO readings (farm_id, ts, temp_f, rh_pct, soil_moisture_pct, tank_pct, sensor_health)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [farm.farm_id, new Date().toISOString(), values.temp_f, values.rh_pct, values.soil_moisture_pct, values.tank_pct, 1]
    );

    const staticMap = await getStaticThresholdMap(farm.farm_id);
    const dynamicMap = await getLatestDynamicThresholdMap(farm.farm_id);

    for (const metric of ['temp_f', 'rh_pct', 'soil_moisture_pct']) {
      const staticBreach = compareAgainstThreshold(values[metric], staticMap[metric]);
      if (shouldEmitAlert(farm.farm_id, metric, 'static', staticBreach)) {
        await createAlert(farm.farm_id, metric, 'static', values[metric], staticMap[metric]);
      }

      const dynamicBreach = compareAgainstThreshold(values[metric], dynamicMap[metric]);
      if (shouldEmitAlert(farm.farm_id, metric, 'dynamic', dynamicBreach)) {
        await createAlert(farm.farm_id, metric, 'dynamic', values[metric], dynamicMap[metric]);
      }
    }
  }
}
