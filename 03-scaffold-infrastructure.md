# 03 — SCAFFOLD & INFRASTRUCTURE

## Objective
Stand up the monorepo, database, queue, and deploy pipeline so every later doc's prompt drops into a
working skeleton. One day of work, done once, properly.

## Key decisions (made)
- **Stack:** pnpm workspaces · TypeScript strict everywhere · Fastify (API) · Next.js 14 (web) ·
  Drizzle ORM + Postgres 16 · Redis + BullMQ · Zod at every boundary. (Your standard stack — zero
  learning curve.)
- **Hosting:** Railway or Fly.io for api+workers+Postgres+Redis (you know Replit, but a game economy
  holding real value should not live on Replit — process isolation and secrets hygiene matter here).
  Vercel for `apps/web`. Helius for RPC + webhooks (dedicated plan at launch).
- **Environments:** `dev` (devnet token) → `staging` (devnet, prod infra) → `prod` (mainnet).
- **Ledger principle:** all balances are rows in a double-entry ledger table. No column ever stores
  "balance" as mutable truth; balances are materialized views/cached sums. This single decision
  prevents 90% of game-economy exploits (race-condition double-spends).

## Build checklist
- [ ] Repo init, pnpm workspace, shared tsconfig/eslint/prettier
- [ ] `packages/db` with Drizzle schema v0 (tables below) + migration pipeline
- [ ] `services/api` Fastify skeleton: health, zod-typed route plugin pattern, error envelope
- [ ] BullMQ worker process with a heartbeat job
- [ ] Docker compose for local Postgres+Redis
- [ ] CI: typecheck, lint, vitest, drizzle migration check on PR
- [ ] Railway/Fly deploy for api+worker, Vercel for web, env secret management
- [ ] Sentry (api+web) + structured pino logging

## Schema v0 (later docs extend)
`users`, `wallets`, `sessions`, `ledger_entries` (double-entry: account, delta, currency, ref_type,
ref_id, idempotency_key UNIQUE), `accounts` (user game balance, treasury, burn_pool, pd_pool,
emissions_budget), `characters`, `missions`, `mission_outcomes`, `locations` (config), `deposits`,
`withdrawals`, `audit_log`.

## Claude Code prompt

```
Scaffold a production-grade pnpm monorepo called trash-wars for a Solana idle game backend.

STRUCTURE
- apps/web (Next.js 14 App Router, TS, Tailwind — placeholder landing page only for now)
- apps/admin (Next.js, placeholder)
- services/api (Fastify 4, TS)
- services/worker (BullMQ worker entrypoint, shares code with api via packages)
- packages/db (Drizzle ORM, Postgres), packages/shared (zod schemas, types),
  packages/economy (placeholder — will be filled by another task), packages/chain (placeholder)
- ops/, docs/

REQUIREMENTS
1. Strict TypeScript everywhere, single root tsconfig.base.json, project references.
2. packages/db: Drizzle schema with these tables (sensible columns, created_at/updated_at,
   uuid pks):
   users, wallets(user_id, address unique, chain), sessions, 
   accounts(id, owner_type enum[user,system], owner_id nullable, kind enum[game_balance,
   treasury, burn_pool, pd_pool, emissions_budget, deposits_pending], currency default 'SHINY'),
   ledger_entries(id, account_id, delta bigint, currency, ref_type, ref_id, idempotency_key
   unique, created_at) with a CHECK preventing delta=0,
   locations(slug, name, config jsonb, enabled bool),
   characters(id, owner_user_id, nft_mint nullable, faction enum, level, stats jsonb, status
   enum[idle,on_mission,jailed,dead], jailed_until),
   missions(id, character_id nullable, user_id, location_slug, stake bigint, state
   enum[active,resolving,resolved,cancelled], server_seed_hash, server_seed nullable,
   client_seed, started_at, resolves_at),
   mission_outcomes(mission_id, outcome enum, payout bigint, detail jsonb),
   deposits(id, user_id, tx_sig unique, amount, state), 
   withdrawals(id, user_id, amount, fee, dest_address, state enum[queued,review,sent,failed],
   tx_sig nullable),
   audit_log(actor, action, detail jsonb).
3. packages/db exports a LedgerService with a single method postTransaction(entries[],
   idempotencyKey) that: runs in a serializable transaction, validates entries sum to zero
   per currency (double-entry), inserts, and exposes getBalance(accountId) as SUM(delta).
   Include vitest tests proving: concurrent double-spend with same idempotency key cannot
   create duplicates; unbalanced transactions are rejected.
4. services/api: Fastify with zod-type-provider, route plugin pattern, /health, global error
   envelope {error:{code,message}}, pino logging, helmet/cors, rate-limit plugin configured.
5. services/worker: BullMQ connection, one repeating heartbeat job writing to audit_log.
6. docker-compose.yml: postgres:16, redis:7. .env.example with all vars. 
7. CI: GitHub Actions — pnpm install, typecheck, lint, test, drizzle-kit check.
8. README with local dev quickstart (docker compose up, pnpm db:migrate, pnpm dev).

Do not implement game logic. Deliver the skeleton with all tests green.
```

## Acceptance criteria
- `docker compose up && pnpm dev` gives a healthy API + worker locally
- Ledger double-spend test passes under concurrency
- CI green; staging deploy reachable
