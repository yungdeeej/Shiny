# Railway deploy (alternative to Fly)

Doc 03 calls for "Railway **or** Fly.io for api+workers+Postgres+Redis." Fly is
the worked example (`ops/deploy/fly/`, `ops/deploy/README.md`). This is the
equivalent Railway setup if you prefer Railway's managed Postgres/Redis + Git
deploys. Pick one host; do not split services across both.

## Topology

One Railway **project** with four services:

| Service           | Type             | Source / image                         | Public? |
|-------------------|------------------|----------------------------------------|---------|
| `postgres`        | Railway plugin   | Postgres 16                            | no      |
| `redis`           | Railway plugin   | Redis 7                                | no      |
| `api`             | Dockerfile build | `services/api/Dockerfile`              | yes (:4000) |
| `worker`          | Dockerfile build | `services/worker/Dockerfile`           | no      |

`apps/web` does **not** run on Railway — it deploys to Vercel (`apps/web/vercel.json`).

## Setup

1. **Create the project** and add the **Postgres** and **Redis** plugins. Railway
   provisions `DATABASE_URL` and `REDIS_URL` and exposes them as referenceable
   variables (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`).

2. **api service** — connect the GitHub repo (or `railway up` from the repo root).
   - Build: **Dockerfile**, path `services/api/Dockerfile`, **build context = repo
     root** (the image copies the whole workspace). In Railway set the service
     Root Directory to `/` and the Dockerfile path to `services/api/Dockerfile`.
   - Networking: enable a public domain; set the **target port to 4000**.
   - Health check path: `/health`.
   - Variables (see the secrets inventory in `docs/ops/SECRETS.md`):
     ```
     NODE_ENV=production
     BETA_MODE=0
     API_PORT=4000
     SOLANA_CLUSTER=mainnet-beta
     WEB_ORIGIN=https://trashwars.gg
     DATABASE_URL=${{Postgres.DATABASE_URL}}
     REDIS_URL=${{Redis.REDIS_URL}}
     SOLANA_RPC_URL=…            SHINY_MINT=…
     DEPOSIT_ADDRESS=…           MULTISIG_ATA=…
     HELIUS_API_KEY=…            HELIUS_WEBHOOK_SECRET=…
     SERVER_SEED_ENCRYPTION_KEY=…  (32-byte hex, never in git)
     REVENUE_WALLET=…            DISCORD_ADMIN_WEBHOOK_URL=…   SENTRY_DSN=…
     ```
     Do **not** set hot-wallet / mint-authority keys here.

3. **worker service** — same repo, Dockerfile path `services/worker/Dockerfile`,
   context = repo root. **No public domain.** Variables: the same as api **plus**
   the worker-only signing keys:
   ```
   HOT_WALLET_KEYPAIR        (or HOT_WALLET_KEYPAIR_PATH + mounted volume)
   MINT_AUTHORITY_KEYPAIR    (or MINT_AUTHORITY_KEYPAIR_PATH + volume)
   ```
   Keep `DATABASE_URL` / `REDIS_URL` pointed at the same plugins as api.

4. **Migrations / seed** run on api boot (the server migrates + seeds itself —
   see README). No separate release command is required for v1. If you later add
   a build step, wire `pnpm db:migrate` as a Railway *pre-deploy* command on api.

## CI/CD

Railway's native GitHub integration redeploys on push to the production branch.
If you instead drive deploys from `.github/workflows/deploy.yml`, swap the
`flyctl deploy` steps for `railway up --service api|worker` with a
`RAILWAY_TOKEN` GitHub secret. The economy-sim pre-deploy gate
(`node ops/check-sim-bands.mjs`) stays identical.

## Accounts you must create

- Railway account + project, Postgres plugin, Redis plugin.
- `RAILWAY_TOKEN` in GitHub if deploying from CI.
