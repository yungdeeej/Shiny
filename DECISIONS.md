# DECISIONS.md — the memory between sessions

| Date | Decision | Reason |
|---|---|---|
| 2026-06-10 | v1 custody is custodial ledger + PGlite/Postgres dual-mode; Anchor escrow deferred | Doc 00; PGlite lets the whole stack boot with zero infra for beta |
| 2026-06-10 | Beta runs at 60× time (`BETA_TIME_SCALE`); in-browser demo client is the public beta | Playable-in-one-sitting loop; zero-infra Vercel deploy |
| 2026-06-10 | Beta auth = guest handles; wallet connect (SIWS) ships with the devnet build | No real token pre-TGE; SIWS architecture present from day 1 |
| 2026-06-10 | S1 v2 economy tune (owner-approved): APR target 35–45%, design point 2,000 DAU, free rein on doc numbers | Sim proved v1.0 numbers infeasible: PD APR ~2,500%, idle alone exceeded daily budget |
| 2026-06-10 | lossSplit 99.5/0.5 burn/PD; patrol bounty 1%; stake caps cut ~100×; idle 4–15/hr | Only configuration class that holds the APR band under a fixed emissions budget |
| 2026-06-10 | **v1.1 reconciliation**: lossSplit = 94.5% burn / 0.5% PD / 5% jackpot — NOT doc 14's 45/50/5 | Doc 14's split was written against v1.0 (50/50), before the approved APR tune; 50% to PD would re-blow the APR band ~100×. Burn gives up the 5 jackpot points; PD sliver preserved |
| 2026-06-10 | Jackpot win binds to The Mint's `jackpot` outcome row (currently 10×, not the doc's legacy 12×) | S1 v2 tune set the row to 10×; specs/03 binds to the row, not the number |
| 2026-06-10 | specs/02 (Season Pass) and specs/03 (Jackpot) reconstructed from docs 13/14 — originals not uploaded | Gaps filled per template with ASSUMPTION markers; owner to review |
| 2026-06-10 | Beta stub wallet holding = 50k (Block tier) via `BETA_STUB_HOLDING`; demo client ships a labeled tier simulator | Shows the tier system mid-ladder without maxing perks; demo testers can explore all tiers |
| 2026-06-10 | Demo client compresses jackpot winnable-at to ~15 real min (API: game-day 56 per spec) | Testers must be able to experience the vault opening within a session |
| 2026-06-10 | Devnet TGE rehearsal prepared, dry-run validated; blocked on faucet SOL (captcha) | `ops/launch/REHEARSAL.md` is the fund-and-fire runbook |
| 2026-06-15 | Real signing provider (SolanaChainProvider) lives in services/worker, not packages/chain | Keeps packages/chain light/isomorphic (no mpl-core bundle bloat); the API never holds keys (doc 05 invariant) — it only reads chain; the worker signs |
| 2026-06-15 | SOL payment rail: server builds unsigned tx + memo reference, verifies finalized on /confirm, idempotent on tx_sig (sol_payments table) | Doc 11 build-tx→confirm pattern; memo binds product+reference so verified lamports re-price server-side, never trusting client input |
| 2026-06-15 | NFT collection ships as deterministic code-drawn SVG→PNG (ops/art), NOT diffusion | No image-gen tooling available; code-SVG gives provably-rare, on-brand, reproducible art for thousands of assets; FLUX is a documented insertion point behind FAL_KEY |
| 2026-06-15 | mpl-core create/freeze/burn/attributes + Irys upload calls marked UNVERIFIED pending devnet rehearsal | No live RPC/funded key in the build env; plugin/collection arg shapes vary across mpl-core v1 minors — must round-trip on devnet before mainnet |
