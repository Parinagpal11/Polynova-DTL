import React from 'react';

export default function AlertTable({ alerts }) {
  return (
    <div className="card">
      <h3>Recent Alerts</h3>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Rule</th>
            <th>Metric</th>
            <th>Severity</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.ts).toLocaleString()}</td>
              <td>{a.rule_type}</td>
              <td>{a.metric}</td>
              <td>{a.severity}</td>
              <td>{a.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
