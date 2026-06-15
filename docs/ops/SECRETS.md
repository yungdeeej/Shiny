# Secrets & Custody

Every production secret, where it lives, who can read it, and how it rotates.
Source of truth for env *names* is `services/api/src/core/env.ts` +
`.env.production.example`. **Nothing sensitive is ever committed to git.**

## Where secrets live

| Store | Holds | Set with |
|---|---|---|
| **Fly secrets — `trash-wars-api`** | api runtime env (db, redis, chain reads, alerts) | `fly secrets set -a trash-wars-api K=V` |
| **Fly secrets — `trash-wars-worker`** | worker env **+ the only copy of signing keys** | `fly secrets set -a trash-wars-worker K=V` |
| **Vercel project env** | `NEXT_PUBLIC_*` web config (all public) | Vercel dashboard / `vercel env` |
| **GitHub Actions secrets** | CI/deploy tokens (`FLY_API_TOKEN`) | repo → Settings → Secrets |
| **Squads multisig (on-chain)** | 700M emissions reserve, 3-of-5 signers | Squads app + hardware wallets |
| **KMS / password manager (offline)** | master copies of keypairs + encryption key, break-glass | 1Password/KMS, restricted |

Fly secrets are encrypted at rest and injected as env at boot; updating one
triggers a rolling restart. Treat a rotation as a (brief) restart event.

## Full inventory

### API (Fly `trash-wars-api`)
| Var | Sensitivity | Notes |
|---|---|---|
| `DATABASE_URL` | secret (creds) | Postgres 16; shared with worker |
| `REDIS_URL` | secret (creds) | Redis 7 / BullMQ; shared with worker |
| `SOLANA_RPC_URL` | secret | Helius URL embeds the api key |
| `HELIUS_API_KEY` | secret | Helius dedicated plan |
| `HELIUS_WEBHOOK_SECRET` | secret | verified by `/webhooks/helius`; must match worker |
| `SHINY_MINT` | public | mainnet mint address |
| `DEPOSIT_ADDRESS` | public | hot-wallet $SHINY ATA (reserve read) |
| `MULTISIG_ATA` | public | Squads $SHINY ATA (reserve read) |
| `SERVER_SEED_ENCRYPTION_KEY` | **critical** | see below |
| `REVENUE_WALLET` | public | revenue/SOL destination |
| `DISCORD_ADMIN_WEBHOOK_URL` | secret | alert channel; treat as secret (anyone with it can post) |
| `SENTRY_DSN` | low | ingest-only DSN |
| `WEB_ORIGIN`, `API_PORT`, bank-policy vars, `BETA_MODE=0` | config | non-secret, also in fly.toml `[env]` |

### Worker (Fly `trash-wars-worker`)
Everything the api has (db, redis, chain, alerts, `SERVER_SEED_ENCRYPTION_KEY`)
**plus the signing keys, which exist ONLY here**:

| Var | Sensitivity | Notes |
|---|---|---|
| `HOT_WALLET_KEYPAIR` / `HOT_WALLET_KEYPAIR_PATH` | **critical** | pays withdrawals; capped balance (see below) |
| `MINT_AUTHORITY_KEYPAIR` / `MINT_AUTHORITY_KEYPAIR_PATH` | **critical** | should be revoked post-TGE per doc 02; if retained, hardware-backed |

> Doc 05 invariant: *hot wallet key only in the worker process env, never in the
> api.* The api is internet-facing; the worker is not. Do not violate this.

### Web (Vercel) — all public (`NEXT_PUBLIC_*`)
`NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`,
`NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_RPC_URL`. These ship in the
browser bundle — never put a real secret behind a `NEXT_PUBLIC_` name.

### GitHub
`FLY_API_TOKEN` (deploy). Optional Environment var `API_HEALTH_URL` for the
post-deploy smoke test. Prefer a Fly **deploy token** scoped to the apps.

## The critical four

### 1. `SERVER_SEED_ENCRYPTION_KEY`
- 32-byte hex. Encrypts persisted mission **server seeds** — the commit-reveal
  provably-fair scheme (CLAUDE.md invariant 4) depends on it.
- **Must be identical** on api and worker, **stable** over time, and **secret**.
- Leak → fairness is broken (outcomes become predictable). Loss → in-flight
  missions can't be revealed and `/verify` breaks.
- Store the master in KMS/password manager; mirror into both Fly apps. Rotation
  is **not** a routine op — only on suspected compromise, and only with a
  migration that re-encrypts existing seeds (settled missions keep their revealed
  plaintext seeds, so verification history survives).

### 2. `HOT_WALLET_KEYPAIR` (worker only)
- Pays withdrawals. **Capped at ~48h of expected withdrawal volume** (doc 05);
  the rest stays in the multisig. The worker alerts to top up from the multisig
  when the runway drops; it pauses the queue if it can't cover the next payout.
- Compromise is a P0 — see `docs/ops/RUNBOOKS.md` → *Hot-wallet compromise*
  (pause withdrawals via the admin kill-switch, then rotate).
- Rotate: routinely each season, and immediately on any suspicion. Generate a new
  keypair, fund it from the multisig, swap the worker secret, drain/abandon the
  old one.

### 3. `MINT_AUTHORITY_KEYPAIR` (worker only)
- Per doc 02 the mint authority is **revoked after full supply is minted** (1B,
  6 decimals). If revoked, this need not exist in prod at all — prefer that. If
  retained for any pre-TGE operation, it is hardware-backed and offline; never a
  plain Fly secret on a running service longer than the operation needs it.

### 4. Squads 3-of-5 multisig (700M emissions reserve)
- Not an env var — on-chain custody. Signers: you + 2 trusted + 2 hardware
  backups (doc 02). Published + labeled on Solscan. Streams weekly to the hot
  treasury, never more than ~2 weeks of budget hot.
- Top-ups to the hot wallet are multisig transactions requiring 3 signatures.
  This friction is the point: a single compromised key cannot move the reserve.

## Rotation policy (summary)

| Secret | Cadence | Trigger-based |
|---|---|---|
| `FLY_API_TOKEN` / deploy tokens | quarterly | on contributor offboarding |
| `HELIUS_API_KEY` + RPC URL | as needed | on leak; reissue in Helius |
| `HELIUS_WEBHOOK_SECRET` | semi-annual | rotate on both api+worker together |
| `DISCORD_ADMIN_WEBHOOK_URL` | as needed | on leak (delete + recreate webhook) |
| `DATABASE_URL` / `REDIS_URL` creds | per provider policy | on leak |
| `HOT_WALLET_KEYPAIR` | per season | immediately on suspected compromise |
| `SERVER_SEED_ENCRYPTION_KEY` | never (routine) | only on compromise, with re-encrypt migration |
| Multisig signer keys | per signer policy | on signer loss/turnover (3-of-5 tolerates) |

## Accounts / credentials the owner must create
- Fly.io org + the two apps (`trash-wars-api`, `trash-wars-worker`) + a deploy token.
- Managed Postgres 16 + Redis 7 (Fly/Neon/Upstash/Railway).
- Helius dedicated plan (RPC + webhooks).
- Vercel project for `apps/web` (Root Directory `apps/web`).
- Squads 3-of-5 multisig with hardware backups.
- Discord admin webhook + Sentry projects (api, worker).
- GitHub Environments `staging` and `prod` with required reviewers for prod.
