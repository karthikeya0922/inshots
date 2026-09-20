import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, "0")}:00`,
  latency: 120 + Math.round(40 * Math.sin(i / 3)) + (i === 14 ? 210 : 0) + (i === 19 ? 95 : 0),
}));

export default function AnomalyChart({ height = 260 }) {
  return (
    <div className="chart-card">
      <div className="card-head">
        <h3>p95 latency · api-gateway</h3>
        <span className="badge warn">2 anomalies</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="lat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1f2937" vertical={false} />
          <XAxis dataKey="hour" stroke="#6b7280" tickLine={false} axisLine={false} interval={3} />
          <YAxis stroke="#6b7280" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1f2937" }} />
          <ReferenceLine y={260} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "threshold", fill: "#f59e0b", fontSize: 12 }} />
          <Area type="monotone" dataKey="latency" stroke="#22d3ee" fill="url(#lat)" strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
