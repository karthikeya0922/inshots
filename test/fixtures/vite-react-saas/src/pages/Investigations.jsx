import { useState } from "react";

export default function Investigations() {
  const [notes, setNotes] = useState([
    { who: "maya", text: "Spike lines up with the 14:00 deploy of api-gateway v2.31.", when: "2 min ago" },
    { who: "dev", text: "Rolling back canary. Watching p95.", when: "1 min ago" },
  ]);
  const [draft, setDraft] = useState("");
  return (
    <section className="page">
      <div className="page-head">
        <h1>Investigation · a-1042</h1>
        <p className="muted">p95 latency on api-gateway, +210ms over threshold.</p>
      </div>
      <div className="split">
        <div className="card wide">
          <h4>Timeline</h4>
          <ul className="timeline">
            <li><span className="dot" />13:58 deploy api-gateway v2.31</li>
            <li><span className="dot warn" />14:02 anomaly detected (+210ms)</li>
            <li><span className="dot" />14:05 rule latency-p95 fired → #oncall</li>
            <li><span className="dot ok" />14:09 canary rollback started</li>
          </ul>
        </div>
        <div className="card wide">
          <h4>Notes</h4>
          {notes.map((n, i) => (
            <div className="note" key={i}>
              <strong>@{n.who}</strong> <span className="muted">{n.when}</span>
              <p>{n.text}</p>
            </div>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); if (draft) setNotes([...notes, { who: "you", text: draft, when: "now" }]); setDraft(""); }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note for the team…" />
            <button className="btn" type="submit">Add note</button>
            <button className="btn ghost" type="button">Hand off</button>
          </form>
        </div>
      </div>
    </section>
  );
}
