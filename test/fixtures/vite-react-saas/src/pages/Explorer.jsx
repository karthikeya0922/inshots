import { useState } from "react";
import AnomalyChart from "../components/AnomalyChart.jsx";

const metrics = ["p95 latency", "error rate", "queue depth", "cpu", "memory", "requests/s"];

export default function Explorer() {
  const [metric, setMetric] = useState(metrics[0]);
  const [threshold, setThreshold] = useState(true);
  return (
    <section className="page">
      <div className="page-head">
        <h1>Metric explorer</h1>
        <p className="muted">Chart any metric and overlay the anomaly threshold.</p>
      </div>
      <div className="toolbar">
        {metrics.map((m) => (
          <button key={m} className={`chip ${metric === m ? "active" : ""}`} onClick={() => setMetric(m)}>
            {m}
          </button>
        ))}
        <button className="btn ghost" onClick={() => setThreshold((t) => !t)}>
          {threshold ? "Hide threshold" : "Show threshold"}
        </button>
      </div>
      <AnomalyChart height={360} />
      <div className="cards">
        <div className="card"><h4>Peak</h4><strong>371 ms</strong><span className="muted">14:00 · 2.9× baseline</span></div>
        <div className="card"><h4>Baseline</h4><strong>128 ms</strong><span className="muted">rolling 7-day median</span></div>
        <div className="card"><h4>Threshold</h4><strong>260 ms</strong><span className="muted">from rule latency-p95</span></div>
      </div>
    </section>
  );
}
