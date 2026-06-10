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
