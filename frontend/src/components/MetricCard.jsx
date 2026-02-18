import React from 'react';

export default function MetricCard({ title, value }) {
  return (
    <div className="card metric-card">
      <div className="metric-title">{title}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}
