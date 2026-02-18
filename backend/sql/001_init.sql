PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS farms (
  farm_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  crop TEXT,
  season TEXT
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  temp_f REAL NOT NULL,
  rh_pct REAL NOT NULL,
  soil_moisture_pct REAL NOT NULL,
  tank_pct REAL,
  sensor_health INTEGER DEFAULT 1,
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);

CREATE INDEX IF NOT EXISTS idx_readings_farm_ts ON readings(farm_id, ts);

CREATE TABLE IF NOT EXISTS static_thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  low REAL,
  high REAL,
  effective_from TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);

CREATE TABLE IF NOT EXISTS dynamic_thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  low REAL,
  high REAL,
  method TEXT NOT NULL,
  window_hours INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);

CREATE INDEX IF NOT EXISTS idx_dynamic_farm_metric_time ON dynamic_thresholds(farm_id, metric, updated_at);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  metric TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);

CREATE TABLE IF NOT EXISTS events_ground_truth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id TEXT NOT NULL,
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);

CREATE TABLE IF NOT EXISTS experiments (
  experiment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL,
  farm_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  false_alert_rate REAL,
  miss_rate REAL,
  precision REAL,
  recall REAL,
  lead_time_min REAL,
  tp_count INTEGER DEFAULT 0,
  fp_count INTEGER DEFAULT 0,
  fn_count INTEGER DEFAULT 0,
  alerts_per_day REAL DEFAULT 0,
  window_label TEXT DEFAULT 'event_window',
  FOREIGN KEY (experiment_id) REFERENCES experiments(experiment_id),
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
);
