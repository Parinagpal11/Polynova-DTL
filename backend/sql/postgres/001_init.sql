CREATE TABLE IF NOT EXISTS farms (
  farm_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  crop TEXT,
  season TEXT
);

CREATE TABLE IF NOT EXISTS readings (
  id BIGSERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(farm_id),
  ts TIMESTAMPTZ NOT NULL,
  temp_f DOUBLE PRECISION NOT NULL,
  rh_pct DOUBLE PRECISION NOT NULL,
  soil_moisture_pct DOUBLE PRECISION NOT NULL,
  tank_pct DOUBLE PRECISION,
  sensor_health INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_readings_farm_ts ON readings(farm_id, ts);

CREATE TABLE IF NOT EXISTS static_thresholds (
  id BIGSERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(farm_id),
  metric TEXT NOT NULL,
  low DOUBLE PRECISION,
  high DOUBLE PRECISION,
  effective_from TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dynamic_thresholds (
  id BIGSERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(farm_id),
  metric TEXT NOT NULL,
  low DOUBLE PRECISION,
  high DOUBLE PRECISION,
  method TEXT NOT NULL,
  window_hours INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dynamic_farm_metric_time
ON dynamic_thresholds(farm_id, metric, updated_at);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(farm_id),
  ts TIMESTAMPTZ NOT NULL,
  metric TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events_ground_truth (
  id BIGSERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(farm_id),
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
  experiment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id BIGSERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  farm_id TEXT NOT NULL REFERENCES farms(farm_id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  false_alert_rate DOUBLE PRECISION,
  miss_rate DOUBLE PRECISION,
  precision DOUBLE PRECISION,
  recall DOUBLE PRECISION,
  lead_time_min DOUBLE PRECISION,
  tp_count INTEGER DEFAULT 0,
  fp_count INTEGER DEFAULT 0,
  fn_count INTEGER DEFAULT 0,
  alerts_per_day DOUBLE PRECISION DEFAULT 0,
  window_label TEXT DEFAULT 'event_window'
);
