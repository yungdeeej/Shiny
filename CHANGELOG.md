# Changelog

## v1.2 — Launch readiness: real custody, NFTs, SOL rail, art studio, infra (2026-06-15)

Closes the gap between the devnet beta and mainnet custody of real funds.

### Added
- **Real on-chain custody** (services/worker): `SolanaChainProvider` (the API never
  holds keys) — spl-token `transferChecked` withdrawal payouts + `burnChecked` weekly
  burns, hot-wallet runway preflight with auto-pause + incident, idempotent ledger legs
  posted only after a confirmed signature.
- **NFT minting** (Metaplex Core): mpl-core mint into the collection with Attributes +
  PermanentFreeze + PermanentBurn plugins; BullMQ mint-fulfillment job reads the art
  manifest for uri + stat bands; death → on-chain burn; in-wallet staking via freeze.
- **Real deposits**: Helius webhook parser (secret auth, enhanced + raw payloads,
  SHINY-mint filter, memo→user, tx-sig idempotent credit at finalized).
- **SOL payment rail**: Season Pass premium + premium cosmetics via real SOL — server
  builds an unsigned transfer with a memo reference, `/confirm` verifies the finalized
  tx (exact lamports, correct payer, memo) and grants idempotently (`sol_payments` table).
  Never touches $SHINY.
- **Art & content studio** (ops/art): deterministic code-drawn generative NFT collection
  (trait layers → 2048px PNG → Metaplex metadata → manifest → Irys upload), marketing
  card generator (hero/teaser/faction/Most-Wanted/burn/stats/vault), rarity report.
  FLUX/diffusion is a documented insertion point behind FAL_KEY.
- **In-game art** upgrade (richer avatars + atmospheric city) and a beefed-up Sentinel
  (more noir voice, mint/faction-war events, image-card attachments).
- **Production infra**: api + worker Dockerfiles, Fly/Railway/Vercel configs, a gated
  deploy workflow with the sim-regression preflight, and SECRETS/RUNBOOKS/MONITORING docs.

### Notes
- Beta (`BETA_MODE=1`) is unchanged and fully stubbed; all 191 tests green, both web
  builds pass, sims in band.
- mpl-core + Irys + live-RPC tx verification are marked UNVERIFIED pending a devnet
  rehearsal (no funded key in the build env) — see DECISIONS.md.

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
