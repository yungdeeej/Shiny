# 14 — LAUNCH-SCOPE AMENDMENTS & CODEBASE RECONCILIATION (v1.1)

## Why this doc exists
Docs 00–12 were handed to Claude Code and the build is in flight. This amendment set adds three
**launch-scope** features (Street Cred tiers, Season Pass, Progressive Jackpot) and one economy
routing change. The base docs have been updated to v1.1 so the doc set remains the spec of record,
but the **codebase was built against v1.0** — this doc closes that gap. Paste the reconciliation
prompt at the bottom into your existing Claude Code session.

## Delta summary (v1.0 → v1.1)

| # | Change | Docs touched | Code impact |
|---|--------|--------------|-------------|
| 1 | Loss routing **50/50 → 45% burn / 50% pd_pool / 5% jackpot_pool**; new system account `jackpot_pool`; conservation invariant extended | 01, 06, 08 | packages/economy constants + invariants + sim outputs; mission settlement worker; ledger account seed; tests |
| 2 | **Progressive Jackpot** (specs/03): accrues day 1 (incl. 2M seed event), winnable wk8 via The Mint's existing 12× outcome; public counter endpoint + sockets + VaultWidget | 01, 06, 13 | settlement tx adds jackpot payout path; /public/jackpot; frontend widget + winner takeover |
| 3 | **Street Cred holder tiers** (specs/01): free-tier 10k check becomes Alley tier of a 5-tier system; tier-driven mission slots, withdrawal fee bps, bail discount, mint early access, weekly raffle grant, Kingpin location | 01, 04, 05, 06, 07, 11, 13 | TierService + snapshots; replace hardcoded constants (fee bps, slot count, free-tier gate) with tier lookups |
| 4 | **Season Pass** (specs/02): new module, SOL-rail purchase, XP from existing game events, zero token-economy impact | 11 (reuses SOL flow), 13 | new `pass` module + internal event emitter fan-out from mission/bail/raffle paths |
| 5 | Calendar: all three features move to **wk0 launch scope**; wk7 becomes Hideout Wave 1 + Tournament #1; wk8 = jackpot becomes winnable + Penthouse Job | 13 | none (ops) |
| 6 | Marketing allocation: 2M $SHINY earmarked as jackpot TGE seed | 01, 02 (ops note) | distribution.json adds a jackpot_seed line OR seed via in-game ledger event at day 0 (preferred: in-game ledger seed from the marketing tranche after deposit — keeps on-chain distribution unchanged) |

Unchanged and still binding: all CLAUDE.md invariants, the emissions one-way ratchet, the
"SOL buys flex, SHINY burns buy power" rule (pass/cosmetics contain no token or stat rewards),
provably-fair commit-reveal (jackpot uses the SAME mission roll — no new trust surface).

## Sequencing into the existing build
Run reconciliation in this order (matches dependency reality):
1. **Economy package first** (routing constants, jackpot account, invariants, sim) — everything
   else validates against it. Re-run the 3 standard scenarios; the sim must stay green.
2. **DB migration**: seed `jackpot_pool` system account; `tier_snapshots`, `users.current_tier`,
   `tier_definitions`; pass tables (specs/02); `jackpot_events`; location flag `jackpotEligible`.
3. **Settlement worker** routing change + jackpot win path (atomic, idempotent).
4. **TierService** + replace hardcoded gates (free-tier 10k, withdrawal fee bps, slot count,
   bail price, mint-wave open check, raffle weekly grant).
5. **Season Pass module** (independent; can run parallel to 3–4 in a worktree).
6. **Frontend**: VaultWidget + landing counter, /cred, /pass, tier badge, winner takeover.
7. **Telemetry**: doc 09 dashboards add jackpot size, tier distribution, pass conversion.

## RECONCILIATION PROMPT — paste into the existing Claude Code session

```
The spec set has been amended to v1.1. Read docs/14-launch-scope-amendments.md, then
docs/specs/01-street-cred.md, docs/specs/02-season-pass.md, docs/specs/03-progressive-jackpot.md,
and the AMENDED headers in docs/01, 06, 08, 13. Your task is to reconcile the existing codebase
with v1.1. Work in this order, committing after each numbered step:

1. AUDIT FIRST. Produce a gap report: grep the codebase for every v1.0 assumption that v1.1
   changes — the 50/50 loss routing constant, the hardcoded free-tier 10_000 holding check,
   the hardcoded WITHDRAWAL_FEE_BPS usage, mission slot limits, bail price constant, mint-wave
   open checks, and the ledger conservation invariant/test. List file:line for each. Do not
   change code in this step.
2. packages/economy: change loss routing to 45% burn / 50% pd_pool / 5% jackpot_pool; add the
   jackpot_pool account to the conservation invariant and the simulator (2M day-0 seed event,
   pool pays out on The Mint's 12x outcome with a 10% reset floor holdback once The Mint is
   enabled at day 56); add jackpot size + hits and Street Cred tier distribution to sim config
   and reports. Re-run the 3 standard scenarios; include the before/after inflation delta in
   your summary. All existing tests must pass with updated expectations.
3. Drizzle migration: jackpot_pool system account seed; jackpot_events; tier_snapshots,
   tier_definitions (seed the 5 tiers from specs/01), users.current_tier; season_passes,
   pass_progress, pass_challenges, pass_challenge_progress, pass_rewards; locations gain
   jackpotEligible (true only for the-mint). Migration must be reversible.
4. Mission settlement worker: implement the 45/50/5 routing and the jackpot win path exactly
   per specs/03 — single atomic ledger transaction, idempotent on missionId, winsJackpot bound
   to the existing 12x outcome row only, pool payout = balance minus 10% floor. Update the 10k
   property-based conservation test to include jackpot_pool.
5. TierService per specs/01: on-chain balance resolution (Helius RPC, 5-min Redis cache),
   daily snapshot job, 24h downgrade grace. Replace every hardcoded gate found in step 1 with
   tier lookups: free-tier gate -> Alley; mission slot count -> f(tier); withdrawal fee bps ->
   f(tier); bail discount; mint early-access window; Borough weekly raffle ticket grant job.
   The threshold-change-requires-7-day-notice rule mirrors the existing emissions timelock
   pattern — reuse that mechanism.
6. Season Pass module per specs/02: introduce a small in-process event emitter (plus BullMQ
   fan-out) emitting mission_resolved, bail_paid, raffle_ticket_bought from the existing code
   paths if no event bus exists yet; XP rules, weekly challenge rotation, SOL purchase via the
   existing store SOL-confirm flow, retroactive premium claims. Config validation test: no
   pass reward may contain SHINY amounts or stat effects.
7. API + frontend: GET /public/jackpot (cached 10s, unauthenticated) + jackpot_tick socket
   (throttled 1/10s); VaultWidget on the city map (boarded-up variant pre-enable) and the
   logged-out landing counter; /cred page and tier badge; /pass page and Heat Meter chip;
   jackpot winner ResultTakeover variant; GET /me extended with tier info.
8. Telemetry: add jackpot pool size, tier distribution histogram, and pass premium conversion
   to the admin dashboard and /public/stats.
9. Final pass: update CHANGELOG.md with a v1.1 section; run the FULL test suite and the
   economy sim scenarios; produce a summary of (a) everything changed, (b) before/after sim
   deltas, (c) any spec ambiguity you resolved and how — flag those for my review.

Respect CLAUDE.md invariants throughout: bigint money everywhere, every balance change through
LedgerService double-entry with idempotency keys, odds tables untouched, settlement remains a
single transaction, no new infrastructure dependencies.
```

## Process note (going forward)
This is the pattern for every future change while the build is in flight: **amend the base doc →
write/extend the spec → add a delta row here (or a new amendment doc per release) → reconcile via
an audit-first prompt.** Never hand Claude Code a silently-edited doc and assume it diffs; always
make it audit v(n) assumptions before writing v(n+1) code. Doc 13 §5's weekly cycle absorbs this
as standard practice post-launch.
