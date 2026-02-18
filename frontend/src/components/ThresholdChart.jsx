import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export default function ThresholdChart({ readings, metric, thresholds }) {
  const labels = readings.map((r) => new Date(r.ts).toLocaleTimeString());
  const values = readings.map((r) => r[metric]);
  const low = thresholds?.low ?? null;
  const high = thresholds?.high ?? null;

  const data = {
    labels,
    datasets: [
      { label: metric, data: values, borderColor: '#1f77b4', tension: 0.3 },
      {
        label: `${metric} low`,
        data: values.map(() => low),
        borderColor: '#2ca02c',
        borderDash: [6, 6],
        pointRadius: 0
      },
      {
        label: `${metric} high`,
        data: values.map(() => high),
        borderColor: '#d62728',
        borderDash: [6, 6],
        pointRadius: 0
      }
    ]
  };

  return <Line data={data} options={{ responsive: true, maintainAspectRatio: false }} />;
}
