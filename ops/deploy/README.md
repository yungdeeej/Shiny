# Deploy — Trash Wars

Production deployment + ops configs. **This directory configures deploys; it does
not deploy.** Read `docs/03` (infra decisions), `docs/05` (bank/custody),
`docs/02` (TGE playbook) first.

## Topology (what runs where)

```
Vercel ───────────────  apps/web (Next 14)         public
   │                     DEMO_MODE=1 → beta (no backend)
   │                     DEMO_MODE=0 → devnet/prod (talks to api)
   ▼
Fly.io  trash-wars-api ───────  Fastify :4000      public   (reads chain, NO keys)
        trash-wars-worker ────  BullMQ   (no port)  private  (holds signing keys)
        managed Postgres 16 ──  shared by api+worker
        managed Redis 7 ──────  BullMQ queue + cache
Helius ───────────────  RPC + deposit webhooks (dedicated plan)
Squads ───────────────  3-of-5 multisig — 700M emissions reserve (on-chain)
```

Files in this repo:
- `services/api/Dockerfile`, `services/worker/Dockerfile`, root `.dockerignore`
- `ops/deploy/fly/api.fly.toml`, `ops/deploy/fly/worker.fly.toml`
- `ops/deploy/railway/README.md` (alternative host — pick Fly *or* Railway)
- `apps/web/vercel.json`
- `.github/workflows/deploy.yml` (manual, gated; ci.yml stays untouched)
- `.env.production.example`, `docs/ops/{SECRETS,RUNBOOKS,MONITORING}.md`

Railway is a documented alternative (`ops/deploy/railway/README.md`); Fly is the
worked example below.

## Pre-flight checklist (ties to doc 02's T-30 → T-0)

Provisioning / accounts (owner must create these — see SECRETS.md):
- [ ] Fly org + apps `trash-wars-api`, `trash-wars-worker`; a Fly **deploy token**
- [ ] Managed **Postgres 16** + **Redis 7** (Fly/Neon/Upstash)
- [ ] **Helius** dedicated plan (RPC + webhook to `/webhooks/helius`)
- [ ] **Vercel** project for `apps/web` (Root Directory = `apps/web`)
- [ ] **Squads 3-of-5** multisig created, 700M transferred, address published (doc 02)
- [ ] Hot wallet keypair generated, funded to ~48h volume from multisig (doc 05)
- [ ] Discord admin webhook + Sentry projects (api, worker)
- [ ] GitHub Environments `staging` + `prod`; **required reviewers on `prod`**
- [ ] `FLY_API_TOKEN` set as a GitHub secret

Gates (must pass before deploy):
- [ ] `pnpm -r typecheck && pnpm -r test` green
- [ ] `node ops/check-sim-bands.mjs` in band (also enforced by ci.yml + deploy.yml)
- [ ] Legal/compliance sign-off — **hard gate before deposits open** (README / doc 00 §6)
- [ ] All secrets set on the right app (api vs worker); signing keys **worker-only**
- [ ] Mint address + authorities-revoked txs published (doc 02)

## Launch-day deploy sequence (T-0 shape)

Run from the repo root. Do staging first, then prod.

1. **Provision data stores.** Create Postgres 16 + Redis 7; capture
   `DATABASE_URL` + `REDIS_URL`.

2. **Set secrets** (see `docs/ops/SECRETS.md` for the full list):
   ```bash
   fly secrets set -a trash-wars-api \
     DATABASE_URL=… REDIS_URL=… SOLANA_RPC_URL=… SHINY_MINT=… \
     DEPOSIT_ADDRESS=… MULTISIG_ATA=… HELIUS_API_KEY=… HELIUS_WEBHOOK_SECRET=… \
     SERVER_SEED_ENCRYPTION_KEY=… REVENUE_WALLET=… \
     DISCORD_ADMIN_WEBHOOK_URL=… SENTRY_DSN=…

   fly secrets set -a trash-wars-worker \
     DATABASE_URL=… REDIS_URL=… SOLANA_RPC_URL=… SHINY_MINT=… \
     DEPOSIT_ADDRESS=… MULTISIG_ATA=… HELIUS_API_KEY=… HELIUS_WEBHOOK_SECRET=… \
     SERVER_SEED_ENCRYPTION_KEY=… REVENUE_WALLET=… \
     DISCORD_ADMIN_WEBHOOK_URL=… SENTRY_DSN=… \
     HOT_WALLET_KEYPAIR=…            # worker ONLY
   ```
   Keep `SERVER_SEED_ENCRYPTION_KEY` identical on both. Never put the hot-wallet
   key on the api.

3. **Deploy the API** — it migrates + seeds itself on boot (README):
   ```bash
   fly deploy -c ops/deploy/fly/api.fly.toml
   ```
   Wait for the `/health` check to go green.

4. **Deploy the Worker** (now that Redis + db are live and migrated):
   ```bash
   fly deploy -c ops/deploy/fly/worker.fly.toml
   ```

5. **Deploy the Web** via Vercel (Git integration or `vercel --prod`). Set
   `NEXT_PUBLIC_DEMO_MODE=0` for the devnet/prod build, `NEXT_PUBLIC_API_URL` /
   `NEXT_PUBLIC_WS_URL` to the api host, and the Solana cluster/RPC vars. (The
   public **beta** site is a separate Vercel deploy with `DEMO_MODE=1`.)

6. **Smoke test:**
   ```bash
   curl -fsS https://<api-host>/health                      # {"ok":true,...}
   curl -fsS https://<api-host>/public/proof-of-reserves    # liabilities ≤ reserves
   ```
   Confirm a deposit webhook test fires and the worker's reserves snapshot is
   fresh (see MONITORING.md). Sanity-check the kill-switches respond
   (`POST /admin/pause` round-trip on staging).

7. **Open deposits** — only after legal sign-off and reserves verified. Per doc
   02 T+26h: trading live → deposits open → missions live. Keep withdrawals
   under the daily cap and watch the first withdrawal cycle (30 min).

## Notes / inert-safety
- `.github/workflows/deploy.yml` is `workflow_dispatch` only and **no-ops if
  `FLY_API_TOKEN` is absent** — safe in forks/clones.
- The images run TypeScript via `tsx` (no compile step) — acceptable for v1;
  rationale + the later `tsc` optimization are noted in each Dockerfile.
- Do **not** edit `ci.yml`. The deploy workflow re-runs the same gates + sim band
  check as a pre-deploy guard.
