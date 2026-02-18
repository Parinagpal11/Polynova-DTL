INSERT OR IGNORE INTO farms (farm_id, name, location, crop, season) VALUES
('farm_global_1', 'Global Demo Farm 1', 'Temperate Region', 'Tomato', 'Spring'),
('farm_global_2', 'Global Demo Farm 2', 'Arid Region', 'Cucumber', 'Summer'),
('farm_global_3', 'Global Demo Farm 3', 'Tropical Region', 'Pepper', 'Monsoon'),
('farm_global_4', 'Global Demo Farm 4', 'Continental Region', 'Lettuce', 'Autumn');

INSERT OR IGNORE INTO static_thresholds (id, farm_id, metric, low, high, effective_from) VALUES
(1, 'farm_global_1', 'temp_f', 38, 88, datetime('now')),
(2, 'farm_global_1', 'rh_pct', NULL, 85, datetime('now')),
(3, 'farm_global_1', 'soil_moisture_pct', 30, NULL, datetime('now')),
(4, 'farm_global_2', 'temp_f', 38, 88, datetime('now')),
(5, 'farm_global_2', 'rh_pct', NULL, 85, datetime('now')),
(6, 'farm_global_2', 'soil_moisture_pct', 30, NULL, datetime('now')),
(7, 'farm_global_3', 'temp_f', 38, 88, datetime('now')),
(8, 'farm_global_3', 'rh_pct', NULL, 85, datetime('now')),
(9, 'farm_global_3', 'soil_moisture_pct', 30, NULL, datetime('now')),
(10, 'farm_global_4', 'temp_f', 38, 88, datetime('now')),
(11, 'farm_global_4', 'rh_pct', NULL, 85, datetime('now')),
(12, 'farm_global_4', 'soil_moisture_pct', 30, NULL, datetime('now'));

INSERT OR IGNORE INTO experiments (experiment_id, name, method, params_json, created_at) VALUES
('exp_static_v1', 'Static Baseline', 'static', '{"temp":[38,88],"rh_high":85,"soil_low":30}', datetime('now')),
('exp_dynamic_quantile_v1', 'Dynamic Quantile', 'rolling_quantile', '{"window_hours":24,"q_low":0.15,"q_high":0.85}', datetime('now'));

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', datetime('now', '-90 minutes'), datetime('now', '-70 minutes'), 'heat_stress', 'high'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'heat_stress' AND start_ts >= datetime('now', '-2 days')
);

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', datetime('now', '-60 minutes'), datetime('now', '-45 minutes'), 'humidity_spike', 'medium'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'humidity_spike' AND start_ts >= datetime('now', '-2 days')
);

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', datetime('now', '-40 minutes'), datetime('now', '-20 minutes'), 'irrigation_failure', 'high'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'irrigation_failure' AND start_ts >= datetime('now', '-2 days')
);

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', datetime('now', '-15 minutes'), datetime('now', '-5 minutes'), 'sensor_fault', 'medium'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'sensor_fault' AND start_ts >= datetime('now', '-2 days')
);
