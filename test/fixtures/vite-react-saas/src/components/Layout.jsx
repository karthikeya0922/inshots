import { NavLink, Outlet } from "react-router-dom";

const nav = [
  ["/dashboard", "Dashboard"],
  ["/explorer", "Metric explorer"],
  ["/alerts", "Alert rules"],
  ["/investigations", "Investigations"],
];

export default function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark" />
          SignalGrid
        </div>
        <nav>
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="badge ok">stream healthy</span>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <input className="search" placeholder="Search metrics, hosts, anomalies…" />
          <button className="btn ghost">Last 24h</button>
          <button className="btn">New alert rule</button>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
