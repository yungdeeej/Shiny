# 🦝 TRASH WARS

> **Shorefront City. The shiniest token on Solana. Steal it.**
>
> A risk-based idle heist game, token-first. **$SHINY** is the asset — characters are NFTs you
> mint *by burning it*, cops eat what robbers lose, and every sink is a public burn.

**Factions:** 🦝 Raccoons (robbers, 90%) · 🐕 Bloodhound PD (cops, 10% cap, paid from confiscations) · 🐦‍⬛ Crows (Season 2)

📚 Full design docs live in [`docs/`](docs/00-MASTER-PLAN.md) — economy, tokenomics, launch playbook, all of it.

---

## ⚡ Play the beta (zero setup)

The game client ships with a **fully playable in-browser beta**: the real economy engine
(probability tables, commit-reveal provably-fair RNG, burns, jail, PvP patrols) runs client-side
with play-money balances and **time scaled 60×** (a 2h mission resolves in 2 minutes).

```bash
pnpm install
pnpm dev:web        # → http://localhost:3000  (NEXT_PUBLIC_DEMO_MODE=1 is the default)
```

Deploy `apps/web` to Vercel as-is and you have a public beta link.

## 🏗️ Run the full stack (custodial backend)

The backend boots with **no Docker, no Redis, no Solana** in beta mode (PGlite + stubbed chain
+ in-process scheduler):

```bash
cp .env.example .env
pnpm dev:api        # Fastify on :4000 — migrates + seeds itself on first boot
NEXT_PUBLIC_DEMO_MODE=0 pnpm dev:web
```

For production-shaped infra (Postgres 16 + Redis + BullMQ worker):

```bash
docker compose up -d
DATABASE_URL=postgres://trashwars:trashwars@localhost:5432/trashwars pnpm dev:api
REDIS_URL=redis://localhost:6379 pnpm dev:worker
```

## 📦 Monorepo layout

| Path | What it is |
|---|---|
| `apps/web` | The game client — city map, mission board, den, jail, bank, precinct, store, raffles, market, leaderboard, transparency, provably-fair verifier |
| `apps/admin` | Internal admin dashboard (kill switches, withdrawal review) |
| `services/api` | Fastify backend — auth (SIWS), bank, mission engine, characters, PvP, store/raffles/market, public stats, websocket city feed |
| `services/worker` | BullMQ worker (production scheduling; beta uses an in-process scheduler) |
| `services/sentinel` | "The Shorefront Sentinel" — automated noir news posts from game events |
| `packages/economy` | Pure game math: probability tables, EV, commit-reveal RNG, the 180-day economy simulator |
| `packages/db` | Drizzle ORM schema + the double-entry **LedgerService** (every token movement balances to zero) |
| `packages/chain` | Solana abstraction: SIWS verification + `ChainProvider` (beta stub ↔ devnet/mainnet) |
| `packages/shared` | Zod contract shared by client and server |
| `ops/launch` | TGE tooling: mint, distribute, verify, airdrop, holder snapshots (`--dry-run` by default) |
| `docs/` | The 13 design documents |

## 🎲 Provably fair

Every mission commits `sha256(serverSeed)` **before** you stake. Outcome =
`HMAC-SHA256(serverSeed, clientSeed:missionId)` mapped onto the probability table that was
shown (and persisted) at stake time — patrol odds included. After resolution the seed is
revealed and the **/verify** page recomputes everything client-side.

## 🧮 Economy invariants (enforced in code)

- **Double-entry ledger** — no mutable balance columns anywhere; the whole ledger sums to zero.
- **Emissions guard** — payouts draw from a daily budget; the engine clamps, never IOUs.
- **One-way ratchet** — admin can tune emissions *down* instantly; raising anything requires a 48h public timelock.
- **Proof of reserves** — liabilities ≤ reserves, snapshotted continuously, auto-pause on breach.
- Run the simulator: `pnpm sim -- --days 180 --players 2000 --dau-curve growth --seed 42`

## ✅ Quality gates

```bash
pnpm -r typecheck && pnpm -r test    # strict TS everywhere; ledger/economy/engine test suites
```

## ⚠️ Status

**Open beta / pre-TGE.** Beta balances are play-money. Mainnet custody (Squads multisig,
Helius webhooks, Metaplex Core mints) is interface-complete behind `ChainProvider` and lands
with the devnet build per [`docs/02`](docs/02-meteora-launch-playbook.md). Legal review per
[`docs/00 §6`](docs/00-MASTER-PLAN.md) is a hard gate before deposits open.
