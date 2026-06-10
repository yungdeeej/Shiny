"use client";
import { useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type Endpoint = { method: "GET" | "POST"; path: string; label: string; confirm?: boolean };
type Group = { title: string; note: string; endpoints: Endpoint[] };

// Documented checklist of the API's /admin/* surface (docs/03 + docs/09).
// This is a placeholder ops panel — the real admin UI (audit log, TOTP, queues) is a later phase.
const GROUPS: Group[] = [
  {
    title: "Kill switches / pause",
    note: "Global pause toggles. POSTs require a typed confirmation here; the API additionally enforces admin role.",
    endpoints: [
      { method: "POST", path: "/admin/pause/withdrawals", label: "Toggle withdrawals pause", confirm: true },
      { method: "POST", path: "/admin/pause/deposits", label: "Toggle deposits pause", confirm: true },
      { method: "POST", path: "/admin/pause/missions", label: "Toggle missions pause (global)", confirm: true },
    ],
  },
  {
    title: "Withdrawal review",
    note: "Queue of flagged withdrawals (state=review). Approve/deny happens per-id via POST /admin/withdrawals/:id — use the API directly for now.",
    endpoints: [{ method: "GET", path: "/admin/withdrawals?state=review", label: "List review queue" }],
  },
  {
    title: "User ops",
    note: "Lookup + freeze. Freeze blocks missions/withdrawals for a user pending investigation.",
    endpoints: [
      { method: "GET", path: "/admin/users?flagged=1", label: "List flagged users" },
      { method: "POST", path: "/admin/users/freeze", label: "Freeze user (prompted id)", confirm: true },
    ],
  },
  {
    title: "Economy tuning",
    note: "One-way ratchet (docs/09): DECREASES to multipliers/rates apply immediately; INCREASES create a pending change effective_at = now + 48h with an auto-published public notice. Enforced by the API, not this UI.",
    endpoints: [
      { method: "GET", path: "/admin/config", label: "View live economy config" },
      { method: "GET", path: "/admin/config/pending", label: "View pending (timelocked) changes" },
    ],
  },
];

export default function AdminPage() {
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) => setLog((l) => [`${new Date().toISOString()} ${line}`, ...l].slice(0, 50));

  async function hit(ep: Endpoint) {
    let body: string | undefined;
    if (ep.confirm) {
      const phrase = window.prompt(`Type CONFIRM to ${ep.method} ${ep.path}` + (ep.path.includes("users/freeze") ? " — then you'll be asked for a user id" : ""));
      if (phrase !== "CONFIRM") return append(`aborted ${ep.path} (no confirmation)`);
      if (ep.path.includes("users/freeze")) {
        const userId = window.prompt("User id to freeze:");
        if (!userId) return append("aborted freeze (no user id)");
        body = JSON.stringify({ userId });
      }
    }
    try {
      const res = await fetch(`${API}${ep.path}`, {
        method: ep.method,
        credentials: "include",
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      });
      append(`${ep.method} ${ep.path} → ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
    } catch (err) {
      append(`${ep.method} ${ep.path} → network error: ${String(err)} (is the API up at ${API}?)`);
    }
  }

  const card: CSSProperties = { background: "#11151d", border: "1px solid #232a36", borderRadius: 8, padding: 16, marginBottom: 16 };
  const btn: CSSProperties = { background: "#1c2430", color: "#d7dce3", border: "1px solid #2e3a4c", borderRadius: 6, padding: "6px 12px", marginRight: 8, marginTop: 8, cursor: "pointer", font: "inherit" };

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
      <h1 style={{ color: "#f5c84c" }}>Trash Wars — Admin</h1>
      <p style={{ color: "#8b96a5" }}>
        Placeholder ops panel (docs/03). Buttons hit <code>{API}</code>/admin/* with session credentials; all
        actions are role-gated and audit-logged server-side.
      </p>
      {GROUPS.map((g) => (
        <section key={g.title} style={card}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>{g.title}</h2>
          <p style={{ color: "#8b96a5", fontSize: 13 }}>{g.note}</p>
          {g.endpoints.map((ep) => (
            <button key={ep.path} style={btn} onClick={() => void hit(ep)}>
              {ep.method} {ep.path.replace("/admin", "")} — {ep.label}
            </button>
          ))}
        </section>
      ))}
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Response log</h2>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#9fb0c3" }}>{log.join("\n") || "—"}</pre>
      </section>
    </main>
  );
}
