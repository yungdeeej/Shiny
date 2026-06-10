# Changelog

## v1.1 — Launch-scope amendments (2026-06-10)

Reconciliation of the in-flight build with docs/14 (audit-first, per the amendment process).

### Added
- **Street Cred holder tiers** (specs/01): 5 tiers from wallet-held $SHINY (Alley 10k →
  Kingpin 5M). Tier-driven: concurrent mission slots (base 1), withdrawal fee 5→2%, bail
  discount, mint-wave early access, Borough weekly raffle ticket, Kingpin Penthouse Job
  location. 24h downgrade grace; threshold changes need 7-day public notice. `/cred` page +
  tier badge; demo beta ships a labeled holding simulator.
- **Progressive Jackpot** (specs/03): `jackpot_pool` system account, 2M $SHINY day-0 seed,
  5% of every lost stake accrues from day 1; winnable at S1 wk8 via The Mint's jackpot
  outcome (same commit-reveal roll — no new trust surface); payout = pool − 10% reset floor.
  `GET /public/jackpot`, `jackpot_tick` socket, VaultWidget (boarded-up → live), landing
  counter, "THE VAULT IS YOURS" takeover.
- **Season Pass** (specs/02): free + premium (~0.3 SOL; beta = play-money claim) tracks,
  Heat Meter XP from gameplay events, weekly challenges, retroactive premium claims,
  insurance vouchers. Iron rule enforced by config test: no SHINY amounts, no stat effects.
- Live-ops process layer (doc 13 §5): `CLAUDE.md`, `docs/specs/` + template, `DECISIONS.md`,
  `docs/retros/`, CI economy-sim regression gate (`ops/check-sim-bands.mjs`).

### Changed
- **Loss routing**: 94.5% burn / 0.5% pd_pool / 5% jackpot_pool. (Doc 14 prescribed 45/50/5
  against v1.0; reconciled with the owner-approved S1 v2 APR tune — see DECISIONS.md.)
- Free-tier holding gate (10k) is now the Alley tier of the Street Cred system.
- Withdrawal fee, bail price, and mint-wave open checks are tier-resolved functions.
- Ledger conservation invariant + property tests extended with `jackpot_pool`.

## v1.0 — Initial build (2026-06-10)

Full monorepo per docs 00–12: economy package (tables, commit-reveal RNG, 180-day simulator),
double-entry ledger (PGlite/Postgres dual-mode), Fastify API (auth/bank/missions/characters/
PvP/store/raffles/market/public/ws), BullMQ worker, game client with in-browser demo beta
(60× time), admin placeholder, Sentinel content engine, TGE ops scripts, CI. S1 v2 economy
tune (APR 35–45% band, zero clamp days at 2k DAU) and devnet wallet login (SIWS) included.
