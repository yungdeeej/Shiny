# Incident Runbooks

Step-by-step responses for the on-call. All money paths are bigint base units
(6 decimals). The admin kill-switches are `config_kv` flags, toggled via the
admin API; the worker and bank module read them before acting.

## Kill-switches (the levers you'll reach for)

Three pause flags, set through **`POST /admin/pause { "key": "...", "paused": true|false }`**
(admin SIWS + role required; every call is written to `audit_log`). The handler
writes `config_kv` keys `<key>_paused`:

| `key` | flag written | Effect |
|---|---|---|
| `withdrawals` | `withdrawals_paused` | withdrawal worker halts mid-queue safely; new requests rejected |
| `missions` | `missions_paused` | no new missions can be staked |
| `deposits` | `deposits_paused` | deposit crediting halted |

Other admin endpoints you'll use:
`POST /admin/freeze-user {userId, frozen}` · `GET /admin/withdrawals/review` ·
`POST /admin/withdrawals/:id/approve` · `POST /admin/withdrawals/:id/deny`
(deny refunds net+fee to the user's balance).

> If the admin UI/API is unreachable, the flags are plain `config_kv` rows — a
> trusted operator with DB access can `INSERT … ON CONFLICT` set
> `withdrawals_paused=true` directly. This is break-glass; log it in the incident.

---

## 1. Hot-wallet compromise  (P0)

Signing key for the withdrawal hot wallet is leaked/suspected.

1. **Stop the bleed first.** `POST /admin/pause {key:"withdrawals", paused:true}`.
   The worker finishes nothing new; the queue freezes mid-flight (this is tested).
   Confirm via `GET /admin/withdrawals/review` that nothing is `sent` after the pause.
2. **Drain residual funds.** From the multisig, sweep any remaining hot-wallet
   balance to a fresh secure address. The hot wallet is capped at ~48h volume
   (doc 05) so the blast radius is bounded by design.
3. **Rotate the key.** Generate a new hot-wallet keypair. `fly secrets set -a
   trash-wars-worker HOT_WALLET_KEYPAIR=<new>` (or update the mounted path). This
   restarts the worker.
4. **Re-fund** the new hot wallet from the multisig (3-of-5 signatures).
5. **Verify** proof-of-reserves still balances (`GET /public/proof-of-reserves`,
   liabilities ≤ reserves) and `/health` is green.
6. **Resume** withdrawals: `POST /admin/pause {key:"withdrawals", paused:false}`.
   Watch the first cycle (30 min) closely.
7. **Post-mortem:** how the key leaked, audit_log of admin actions, public
   disclosure if any user funds were at risk (see §7).

## 2. Stuck withdrawal queue

Items sit in `queued` and aren't being `sent`.

1. **Triage the cause** (check worker logs / Sentry):
   - **Paused?** `withdrawals_paused` true → un-pause if intended-pause expired.
   - **Hot wallet underfunded?** The worker pauses + alerts with the required
     top-up amount when `balance < next payout`. → top up from multisig, resume.
   - **Global cap hit?** `GLOBAL_DAILY_WITHDRAWAL_CAP` reached → expected throttle;
     resumes next UTC day, or raise the cap deliberately if legitimate.
   - **RPC/Helius failure** sending tx → see §3.
   - **Worker process down** → `fly status -a trash-wars-worker`; restart.
2. **Items in `review`**: these are intentional (over `AUTO_PAY_DAILY_LIMIT` for
   the user that day, or flagged). Clear them via approve/deny in the admin queue.
3. **Items in `failed`**: ledger is **not** auto-reversed (doc 05). Decide per
   item: retry (transient) or refund via the explicit admin endpoint. Never
   silently re-send — confirm the original didn't land on-chain first.
4. Resume and confirm the backlog drains over the next cycles.

## 3. Helius webhook outage

Inbound deposit webhooks (`/webhooks/helius`) stop arriving.

1. **The poller is the fallback.** The worker's deposit poller
   (`getSignaturesForAddress`, every 60s) catches missed deposits on the same
   idempotent path (tx-signature-unique). So a webhook outage degrades *latency*,
   not correctness — deposits still credit, just slower.
2. **Confirm the poller is running** (worker logs / audit_log). If the worker is
   also down, that's the real incident — restart it.
3. **If both webhook and poller are down** (e.g., RPC provider outage): deposits
   pause naturally (nothing to read). Consider `POST /admin/pause
   {key:"deposits"...}` only if you need to stop partial processing; otherwise
   the idempotent path lets you simply catch up when RPC returns.
4. **Recover:** when Helius is back, re-verify the webhook config (address,
   `HELIUS_WEBHOOK_SECRET` matches the api/worker secret). The poller will have
   backfilled anything missed; spot-check recent deposits credited exactly once.
5. Do not widen confirmation rules — keep crediting only at `finalized`
   commitment (reorg safety, doc 05).

## 4. Proof-of-reserves breach  (P0, "impossible")

Liabilities (Σ game_balance + withdrawals_payable) exceed reserves (hot + multisig).

1. **It auto-pauses.** The 10-min snapshot job auto-pauses withdrawals and alerts
   on breach (doc 05/09). Verify `withdrawals_paused=true` actually took.
2. **Do NOT resume withdrawals** until the cause is found and the invariant holds
   again. This is a solvency event — treat as incident, not a glitch.
3. **Investigate**: recent snapshots (`/public/proof-of-reserves` history), the
   ledger (it must sum to zero — CLAUDE.md invariant 2; a non-zero sum points at
   the bug), recent deposits/withdrawals, any manual ledger ops in audit_log.
   A true breach implies a double-credit, a missed burn, or an external token
   movement out of custody.
4. **If reserves are genuinely short**: top up from the multisig to restore
   liabilities ≤ reserves before anything resumes.
5. **Disclose** per §7 if user funds were ever at risk. Solvency incidents are
   trust-defining — over-communicate.

## 5. Emissions-pace alert

Metrics job: emissions spent > 110% of the linear schedule pace.

1. **Not an emergency, but act same-day.** Payouts already clamp to the daily
   emissions budget (CLAUDE.md invariant 6) — players never get IOUs — so this is
   a *tuning* signal, not an insolvency.
2. **Ratchet down** (allowed instantly): reduce location multipliers / accrual
   rates via the admin economy tuner (`POST /admin/tune`). Decreases apply
   immediately; **increases require a 48h timelocked `pending_change`** — you
   cannot quietly raise emissions to "catch up."
3. Re-run the sim if the change is structural: `pnpm sim -- --days 180 ...` then
   `node ops/check-sim-bands.mjs` to confirm bands hold.
4. Watch the next few snapshots to confirm pace returns under 100%.

## 6. RNG chi-square drift alert

Outcome distribution per location diverges from the persisted table (p < 0.001
over trailing ~2k missions) — an exploit-or-bug detector (doc 09).

1. **Assume exploit until disproven.** A real drift means either settlement is
   reading the wrong table or someone is biasing outcomes.
2. **Contain:** `POST /admin/pause {key:"missions", paused:true}` to stop new
   staking while you investigate (refunds aren't needed — in-flight missions
   settle against their persisted table).
3. **Verify fairness path** (CLAUDE.md invariants 3–4): settlement must read the
   **persisted** odds table from the mission row, and outcome =
   `HMAC-SHA256(serverSeed, clientSeed:missionId)`. Recompute a sample on
   `/verify`. If `/verify` reproduces outcomes, the RNG is sound → look for a
   data/labeling bug in the chi-square input, not an exploit.
4. If it's a genuine exploit, go to §7.
5. Resume missions once the table-vs-outcome check is clean.

## 7. Exploit found → pause → disclose → compensate  (doc 12 flow)

1. **Pause** the affected surface immediately (the relevant kill-switch:
   withdrawals/missions/deposits, and/or freeze specific users via
   `/admin/freeze-user`). Stopping further loss outranks elegance.
2. **Quantify** from the ledger: exactly who gained/lost what (the double-entry
   ledger makes this exact — sum the affected idempotency keys). Snapshot state.
3. **Fix** the root cause; add a regression test for the acceptance criterion
   that failed; re-run `pnpm -r test` + the sim bands.
4. **Disclose** publicly: what happened, scope, what was paused, the fix. Honesty
   is the brand (doc 02/09). Use the Discord admin webhook for the alert, a public
   post for users.
5. **Compensate** via explicit ledger transactions (each with its own idempotency
   key, e.g. `compensation:{incidentId}:{userId}`) — never by editing balances
   (there are no mutable balance columns). Re-verify the ledger sums to zero.
6. **Resume** the paused surfaces only after the fix is deployed and verified.
