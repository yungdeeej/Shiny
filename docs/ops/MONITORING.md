# Monitoring & Alerting

What to watch, where the signal comes from, and how alerts reach a human. The
backend already computes most of these; this doc says which knobs to wire to
dashboards/uptime and which thresholds page someone.

## Golden signals (watch continuously)

| Signal | Source | Healthy | Alert when |
|---|---|---|---|
| **Proof-of-reserves ratio** | `GET /public/proof-of-reserves` (10-min snapshot) | liabilities ≤ reserves, always | liabilities > reserves → auto-pause + P0 (see RUNBOOKS §4) |
| **Hot-wallet runway** | worker metrics job | ≥ 48h of withdrawal volume | runway low → top-up alert; can't cover next payout → queue pauses |
| **Withdrawal volume z-score** | metrics job (5-min) | within normal band | spike (high z) → possible drain/sybil; investigate |
| **Emissions vs schedule** | metrics job | ≤ 100% of linear pace | > 110% of pace → ratchet down (RUNBOOKS §5) |
| **RNG chi-square per location** | metrics job (trailing ~2k) | p ≥ 0.001 | p < 0.001 → exploit/bug detector (RUNBOOKS §6) |
| **API liveness** | `GET /health` → `{ok:true}` | 200 + ok | non-200 / timeout → restart / page |
| **Worker liveness** | BullMQ heartbeat → `audit_log`; snapshot freshness | recent | snapshot older than ~15 min → worker stuck |
| **Top-line stats** | `GET /public/stats` | sane DAU/missions/burn | sudden cliff/spike → investigate |

The 5-min metrics job and the 10-min reserves job (doc 09 / doc 05) are the
backbone — they already compute reserves ratio, hot-wallet runway, withdrawal
z-score, emissions pace, and the chi-square. This doc just routes their output.

## Alert delivery — Discord admin webhook

Set `DISCORD_ADMIN_WEBHOOK_URL` (Fly secret on **both** api and worker). The
metrics/reserves/queue jobs post here with severity. This is the primary on-call
channel. Treat the URL as a secret (anyone with it can post). It also carries the
weekly burn draft for human review before publishing (doc 09).

Severity convention:
- **P0 / page**: reserves breach, hot-wallet compromise signal, RNG drift,
  withdrawal queue hard-stuck. Pair the Discord alert with a real pager
  (PagerDuty/Opsgenie/phone) — Discord alone is not a pager.
- **Warn**: hot-wallet runway low, emissions pace > 110%, withdrawal z-score high.
- **Info**: burn drafts, daily summaries.

## Error tracking — Sentry

`SENTRY_DSN` is already an env var (separate DSN per service: api, worker). Wire
it so unhandled errors, withdrawal-send failures, RPC errors, and webhook-verify
failures surface with release tags. Alert on error-rate spikes and on any error
in the bank/settlement code paths (money paths are highest severity).

## Uptime checks (external, e.g. Better Uptime / Pingdom / Fly checks)

| Probe | URL | Expect | Cadence |
|---|---|---|---|
| API health | `https://<api-host>/health` | `200`, body contains `"ok":true` | 30–60s |
| Public reserves | `https://<api-host>/public/proof-of-reserves` | `200`, liabilities ≤ reserves | 1–5 min |
| Web | `https://<web-host>/` | `200` | 1–5 min |

The api fly.toml already declares a container health check on `/health`; the
external uptime check is the independent second opinion (catches a healthy
container behind a broken edge/DNS). Consider also asserting freshness of the
reserves snapshot `timestamp` in the uptime check body — a stale snapshot means
the worker stopped even while `/health` is green.

## Dashboards

The public transparency surface (`/public/stats`, `/public/burns`,
`/public/proof-of-reserves`, `apps/web/transparency`) doubles as a live ops
dashboard — circulating, burned (cumulative + weekly), emissions progress, PD
APR, reserves. For internal ops, point Grafana/Sentry dashboards at the same
metrics the 5-min job writes, plus Fly's built-in CPU/mem/restart metrics for
api and worker.

## What requires owner setup
- Sentry projects (api, worker) → DSNs.
- Discord admin webhook URL.
- An external uptime monitor + a real pager for P0s (Discord is not a pager).
