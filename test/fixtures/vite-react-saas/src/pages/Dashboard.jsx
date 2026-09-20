import AnomalyChart from "../components/AnomalyChart.jsx";

const feed = [
  { id: "a-1042", metric: "p95 latency", source: "api-gateway", severity: "high", when: "2 min ago", delta: "+210ms" },
  { id: "a-1041", metric: "error rate", source: "checkout-svc", severity: "medium", when: "14 min ago", delta: "+1.8%" },
  { id: "a-1040", metric: "queue depth", source: "billing-worker", severity: "low", when: "41 min ago", delta: "+340" },
  { id: "a-1039", metric: "cpu", source: "search-node-3", severity: "medium", when: "1 h ago", delta: "+37%" },
];

export default function Dashboard() {
  return (
    <section className="page">
      <div className="page-head">
        <h1>Anomaly feed</h1>
        <p className="muted">Everything the detector flagged in the last 24 hours.</p>
      </div>
      <div className="stat-row">
        <div className="stat"><span className="label">Open anomalies</span><strong>4</strong></div>
        <div className="stat"><span className="label">Metrics watched</span><strong>128</strong></div>
        <div className="stat"><span className="label">Rules firing</span><strong>2</strong></div>
        <div className="stat"><span className="label">Mean time to ack</span><strong>6m</strong></div>
      </div>
      <AnomalyChart />
      <table className="table">
        <thead>
          <tr><th>ID</th><th>Metric</th><th>Source</th><th>Severity</th><th>Change</th><th>Detected</th></tr>
        </thead>
        <tbody>
          {feed.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.id}</td>
              <td>{row.metric}</td>
              <td>{row.source}</td>
              <td><span className={`badge ${row.severity}`}>{row.severity}</span></td>
              <td className="mono">{row.delta}</td>
              <td className="muted">{row.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
