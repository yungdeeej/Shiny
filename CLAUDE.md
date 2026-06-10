# CLAUDE.md — standing brief for every session

Trash Wars: risk-based idle heist game on Solana. Token $SHINY (6 decimals). The spec of record
is `docs/` (00–14) + `docs/specs/` (feature specs). When code and docs disagree, say so — never
silently pick one.

## Architecture (doc 00)

```
apps/web (Next 14 game client; NEXT_PUBLIC_DEMO_MODE=1 = in-browser beta engine)
apps/admin (placeholder ops panel)
services/api (Fastify: auth/bank/game/characters/pvp/store/raffles/market/pass/public/ws)
services/worker (BullMQ shell over the same core tick functions)
services/sentinel (content automation, dry-run)
packages/economy  ← SINGLE SOURCE OF TRUTH for game math (tables, RNG, splits, sim)
packages/db (Drizzle schema + LedgerService double-entry ledger, PGlite fallback)
packages/chain (SIWS + ChainProvider: beta stub ↔ devnet reads)
packages/shared (zod wire contract + POLICY/TIER/JACKPOT/PASS constants)
```

## Invariants (violating any of these is a blocking review failure)

1. **All money is `bigint`** base units. No floats anywhere near a token amount. Wire format is
   the integer string (`tokenAmount` zod schema).
2. **Every balance change goes through `LedgerService.postTransaction`** — double-entry, sums to
   zero, idempotency key per logical event (`mission:{id}`, `withdraw:{id}`, …). No mutable
   balance columns. The whole ledger must always sum to zero (property tests enforce).
3. **Odds-at-stake-time are honored**: the effective probability table is persisted on the
   mission row at start and settlement reads the persisted table, never live config.
4. **Provably fair**: `sha256(serverSeed)` committed before stake; outcome =
   `HMAC-SHA256(serverSeed, clientSeed:missionId)`; seed revealed at settlement; `/verify`
   must be able to recompute everything.
5. **Settlement is one atomic, idempotent ledger transaction** per mission (escrow, payout,
   emissions, burn, pd, jackpot, bounty legs together).
6. **Emission changes are downward-only without timelock**; increases require a
   `pending_changes` row (+48h). Tier thresholds: ±7 days notice. Payouts clamp to the daily
   emissions budget — players never receive IOUs.
7. **SOL buys flex + convenience; $SHINY burns buy power.** No pass/cosmetic/SOL product may
   carry token amounts or stat effects (config validation tests enforce).
8. No new infrastructure dependency without a note in DECISIONS.md.

## Commands

```bash
pnpm -r typecheck && pnpm -r test          # full gates — must be green before "done"
pnpm --filter @trash-wars/economy sim -- --days 180 --players 2000 --dau-curve growth --seed 42
node ops/check-sim-bands.mjs               # asserts the S1 bands after regenerating sims
pnpm dev:api  /  pnpm dev:web              # zero-infra beta boot
```

## Definition of done

Tests green (incl. new tests for each acceptance criterion of the spec being built) + the three
sim scenarios re-run and inside bands + `CHANGELOG.md` entry + spec/doc updated if behavior
diverged. End every session by running the full suite and summarizing anything failing.

## Process

Feature work is spec-driven: `docs/specs/NN-name.md` (template: `docs/specs/00-TEMPLATE.md`).
Amendments to in-flight builds go through an audit-first reconciliation (see docs/14 — grep for
the old assumptions before writing new code). Decisions land in `DECISIONS.md`.
