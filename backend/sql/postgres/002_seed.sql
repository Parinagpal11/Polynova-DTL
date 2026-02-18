INSERT INTO farms (farm_id, name, location, crop, season) VALUES
('farm_global_1', 'Global Demo Farm 1', 'Temperate Region', 'Tomato', 'Spring'),
('farm_global_2', 'Global Demo Farm 2', 'Arid Region', 'Cucumber', 'Summer'),
('farm_global_3', 'Global Demo Farm 3', 'Tropical Region', 'Pepper', 'Monsoon'),
('farm_global_4', 'Global Demo Farm 4', 'Continental Region', 'Lettuce', 'Autumn')
ON CONFLICT (farm_id) DO NOTHING;

INSERT INTO static_thresholds (farm_id, metric, low, high, effective_from) VALUES
('farm_global_1', 'temp_f', 38, 88, NOW()),
('farm_global_1', 'rh_pct', NULL, 85, NOW()),
('farm_global_1', 'soil_moisture_pct', 30, NULL, NOW()),
('farm_global_2', 'temp_f', 38, 88, NOW()),
('farm_global_2', 'rh_pct', NULL, 85, NOW()),
('farm_global_2', 'soil_moisture_pct', 30, NULL, NOW()),
('farm_global_3', 'temp_f', 38, 88, NOW()),
('farm_global_3', 'rh_pct', NULL, 85, NOW()),
('farm_global_3', 'soil_moisture_pct', 30, NULL, NOW()),
('farm_global_4', 'temp_f', 38, 88, NOW()),
('farm_global_4', 'rh_pct', NULL, 85, NOW()),
('farm_global_4', 'soil_moisture_pct', 30, NULL, NOW());

INSERT INTO experiments (experiment_id, name, method, params_json, created_at) VALUES
('exp_static_v1', 'Static Baseline', 'static', '{"temp":[38,88],"rh_high":85,"soil_low":30}', NOW()),
('exp_dynamic_quantile_v1', 'Dynamic Quantile', 'rolling_quantile', '{"window_hours":24,"q_low":0.15,"q_high":0.85}', NOW())
ON CONFLICT (experiment_id) DO NOTHING;

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', NOW() - INTERVAL '90 minutes', NOW() - INTERVAL '70 minutes', 'heat_stress', 'high'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'heat_stress' AND start_ts >= NOW() - INTERVAL '2 days'
);

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '45 minutes', 'humidity_spike', 'medium'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'humidity_spike' AND start_ts >= NOW() - INTERVAL '2 days'
);

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '20 minutes', 'irrigation_failure', 'high'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'irrigation_failure' AND start_ts >= NOW() - INTERVAL '2 days'
);

INSERT INTO events_ground_truth (farm_id, start_ts, end_ts, event_type, severity)
SELECT 'farm_global_2', NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '5 minutes', 'sensor_fault', 'medium'
WHERE NOT EXISTS (
  SELECT 1 FROM events_ground_truth
  WHERE farm_id = 'farm_global_2' AND event_type = 'sensor_fault' AND start_ts >= NOW() - INTERVAL '2 days'
);
