import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import MetricCard from '../components/MetricCard.jsx';
import ThresholdChart from '../components/ThresholdChart.jsx';
import AlertTable from '../components/AlertTable.jsx';

export default function Dashboard() {
  const [farms, setFarms] = useState([]);
  const [farmId, setFarmId] = useState('');
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [thresholdRows, setThresholdRows] = useState([]);

  useEffect(() => {
    api.farms().then((f) => {
      setFarms(f);
      if (f.length) setFarmId(f[0].farm_id);
    });
  }, []);

  useEffect(() => {
    if (!farmId) return;

    const load = async () => {
      const [r, a, t, allMetrics] = await Promise.all([
        api.readings(farmId, 120),
        api.alerts(farmId, 30),
        api.thresholds(farmId),
        api.metrics(farmId)
      ]);

      setReadings(r);
      setAlerts(a);
      setThresholdRows(t);

      // ✅ FIX: keep ONLY the latest metric per experiment
      const byExperiment = {};
      for (const row of allMetrics) {
        if (row.farm_id !== farmId) continue;

        const prev = byExperiment[row.experiment_id];
        if (!prev || new Date(row.period_end) > new Date(prev.period_end)) {
          byExperiment[row.experiment_id] = row;
        }
      }

      setMetrics(Object.values(byExperiment));
    };

    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [farmId]);

  const latest = readings[readings.length - 1];

  const thresholdMap = useMemo(() => {
    const map = {};
    for (const row of thresholdRows) {
      map[row.metric] = { low: row.low, high: row.high };
    }
    return map;
  }, [thresholdRows]);

  return (
    <div className="page">
      <header>
        <h1>PolyNova DTL Dashboard</h1>
        <select value={farmId} onChange={(e) => setFarmId(e.target.value)}>
          {farms.map((f) => (
            <option key={f.farm_id} value={f.farm_id}>
              {f.name}
            </option>
          ))}
        </select>
      </header>

      <section className="grid-4">
        <MetricCard title="Temp (F)" value={latest ? latest.temp_f.toFixed(1) : '-'} />
        <MetricCard title="Humidity (%)" value={latest ? latest.rh_pct.toFixed(1) : '-'} />
        <MetricCard title="Soil Moisture (%)" value={latest ? latest.soil_moisture_pct.toFixed(1) : '-'} />
        <MetricCard title="Tank (%)" value={latest ? latest.tank_pct.toFixed(1) : '-'} />
      </section>

      <section className="grid-2">
        <div className="card chart-card">
          <h3>Temperature vs Dynamic Threshold</h3>
          <ThresholdChart
            readings={readings}
            metric="temp_f"
            thresholds={thresholdMap.temp_f}
          />
        </div>
        <div className="card chart-card">
          <h3>Soil Moisture vs Dynamic Threshold</h3>
          <ThresholdChart
            readings={readings}
            metric="soil_moisture_pct"
            thresholds={thresholdMap.soil_moisture_pct}
          />
        </div>
      </section>

      <section className="card">
        <h3>Latest Evaluation Metrics</h3>
        {metrics.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No evaluation metrics available.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Experiment</th>
                <th>TP</th>
                <th>FP</th>
                <th>FN</th>
                <th>Alerts/Day</th>
                <th>False Alert Rate</th>
                <th>Miss Rate</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>Lead Time (min)</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.experiment_id}>
                  <td>{m.experiment_id}</td>
                  <td>{m.tp_count ?? 0}</td>
                  <td>{m.fp_count ?? 0}</td>
                  <td>{m.fn_count ?? 0}</td>
                  <td>{m.alerts_per_day?.toFixed(2) ?? '0.00'}</td>
                  <td>{m.false_alert_rate?.toFixed(3) ?? '0.000'}</td>
                  <td>{m.miss_rate?.toFixed(3) ?? '0.000'}</td>
                  <td>{m.precision == null ? 'N/A' : m.precision.toFixed(3)}</td>
                  <td>{m.recall == null ? 'N/A' : m.recall.toFixed(3)}</td>
                  <td>{m.lead_time_min?.toFixed(2) ?? '0.00'}</td>
                  <td>{m.window_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AlertTable alerts={alerts} />
    </div>
  );
}
