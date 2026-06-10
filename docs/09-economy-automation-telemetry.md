# 09 — ECONOMY AUTOMATION: BURNS, BUYBACKS, TELEMETRY & KILL-SWITCHES

## Objective
The machinery that made The Heist's token defensible: visible, regular, numbers-attached burns;
buyback capacity; a live economy dashboard; and admin controls to tune or halt anything in minutes.

## Key decisions (made)
- **Burns are events, not background noise.** The burn_pool ledger account accumulates in-game;
  a weekly job executes the actual on-chain SPL burn from game custody, then auto-drafts the
  announcement ("🔥 Week 7: 14.2M $SHINY burned — 31% from mints, 24% mission losses, …").
  The Heist's cadence of "we burned X, here's the breakdown" was their strongest trust signal —
  copy it exactly.
- **Buyback bot (treasury-funded, discretionary):** rake revenue (withdrawal tax) accrues in
  $SHINY; the SOL reserve from TGE can market-buy $SHINY during drawdowns via Jupiter, routed to
  burn. Manual trigger from admin (you), never automatic — automatic buybacks get front-run.
- **One-way emission ratchet:** admin can reduce location multipliers/accrual rates; raising them
  requires a config change with a 48h public timelock notice. Enforced in code.
- **Public dashboard:** circulating, burned (cumulative + this week), emissions spent vs schedule,
  PD APR, proof-of-reserves, top-line game stats. Transparency is the moat.

## Build checklist
- [ ] Weekly on-chain burn job + breakdown report generator + Discord/X webhook draft
- [ ] Buyback script (Jupiter swap, admin-triggered, slippage-guarded) → burn
- [ ] Admin dashboard app: economy tuning (with ratchet + timelock), kill-switches, user ops,
      withdrawal review queue, incident log
- [ ] Public dashboard page + API
- [ ] Alerting: emissions pace, reserve ratio, hot wallet, withdrawal spikes, sybil spikes,
      RNG distribution drift (chi-square on outcomes vs config — exploit detector)

## Claude Code prompt

```
Build economy automation in ops/ + services/worker + apps/admin + public dashboard endpoints.

BURN MACHINE
1. Worker job 'execute-weekly-burn' (cron Sunday 16:00 UTC): read burn_pool ledger balance,
   execute on-chain spl burn of that amount from the game custody ATA (the in-game burn_pool
   mirrors tokens physically sitting in custody — they entered via deposits), post ledger
   burn_pool -> 'burned' terminal account with tx sig, generate a markdown + image-ready
   breakdown by ref_type over the week (mints, upgrades, mission losses, bail, cosmetics,
   raffles, bribes), POST draft to a Discord admin webhook for human review before publishing.
2. GET /public/burns — history with tx sigs and breakdowns.

BUYBACK
3. ops/buyback.ts — CLI + admin-triggered job: swap X SOL from the buyback reserve wallet to
   SHINY via Jupiter API v6 (quote -> swap, slippageBps configurable, abort if price impact >
   threshold), then burn the proceeds, log + publish. Requires --execute and an admin 2FA
   confirmation flow in the admin app (typed phrase + role check).

ADMIN APP (apps/admin, Next.js, role-gated via users.role='admin')
4. Pages: Economy (live config editor for locations/sinks — writes to config tables with
   validation via @trash-wars/economy invariant checker; DECREASES apply immediately,
   INCREASES create a pending_change row effective_at = now+48h and auto-post a public notice),
   Kill switches (pause: withdrawals, deposits, missions globally, per-location; freeze user),
   Withdrawal review queue (approve/deny), Users (lookup, flags, balances, history),
   Incidents (auto-created by guards + manual), Burn review (publish drafted announcements).
5. Every admin action -> audit_log with actor + diff. Admin auth = SIWS + role + TOTP (speakeasy).

TELEMETRY & ALERTS
6. Metrics job (5 min): emissions spent vs linear schedule (alert if >110% of pace),
   reserves ratio, hot wallet runway hours, withdrawal volume z-score (alert on spike),
   DAU/missions/unique stakers, outcome distribution chi-square per location over trailing
   2k missions vs configured table (alert if p < 0.001 — exploit or bug detector).
   Alerts -> Discord admin webhook with severity.
7. GET /public/stats — the transparency dashboard payload: circulating (1B - burned -
   multisig-held), cumulative burned, weekly burn, emissions schedule progress, PD APR,
   reserves snapshot, totals (players, missions today, biggest heist this week).
   Build apps/web/app/transparency page rendering it with charts (recharts).

TESTS
- Ratchet: increase without timelock rejected at API level; decrease applies instantly.
- Burn job idempotent (re-run doesn't double-burn). Chi-square alarm fires on injected
  skewed outcomes. Buyback aborts on slippage breach.
```

## Acceptance criteria
- One full devnet weekly cycle: burn executed, breakdown drafted, dashboard updated
- Tuning a multiplier down reflects in next mission's displayed table within 60s
- Chi-square detector catches a deliberately rigged test table
