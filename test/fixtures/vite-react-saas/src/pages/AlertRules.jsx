import { useState } from "react";

const initial = [
  { name: "latency-p95", metric: "p95 latency", threshold: "> 260 ms for 5m", channel: "#oncall", enabled: true },
  { name: "errors-checkout", metric: "error rate", threshold: "> 2% for 3m", channel: "#payments", enabled: true },
  { name: "queue-billing", metric: "queue depth", threshold: "> 1000", channel: "#billing", enabled: false },
];

export default function AlertRules() {
  const [rules, setRules] = useState(initial);
  const toggle = (name) => setRules((rs) => rs.map((r) => (r.name === name ? { ...r, enabled: !r.enabled } : r)));
  return (
    <section className="page">
      <div className="page-head">
        <h1>Alert rules</h1>
        <p className="muted">Thresholds per metric, routed to a channel.</p>
      </div>
      <form className="rule-form" onSubmit={(e) => e.preventDefault()}>
        <input placeholder="Rule name" />
        <select defaultValue="p95 latency"><option>p95 latency</option><option>error rate</option><option>cpu</option></select>
        <input placeholder="> 260 ms for 5m" />
        <input placeholder="#channel" />
        <button className="btn" type="submit">Create rule</button>
      </form>
      <table className="table">
        <thead><tr><th>Rule</th><th>Metric</th><th>Condition</th><th>Route</th><th>Enabled</th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.name}>
              <td className="mono">{r.name}</td>
              <td>{r.metric}</td>
              <td className="mono">{r.threshold}</td>
              <td>{r.channel}</td>
              <td><button className={`switch ${r.enabled ? "on" : ""}`} onClick={() => toggle(r.name)} aria-label="Toggle rule"><i /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
