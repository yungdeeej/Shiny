# 05 — THE BANK: DEPOSITS, WITHDRAWALS & CUSTODY

## Objective
The bridge between on-chain $SHINY and the in-game ledger. This is the highest-risk component in
the entire system — it holds player funds. Build it boring, slow, and observable.

## Key decisions (made)
- **v1 custodial model** (Heist/DeFi Dungeons precedent): players transfer $SHINY to a deposit
  address; backend credits game balance on confirmed deposit (Helius webhook + polling fallback).
  Withdrawals are queued, taxed 5%, and paid from a **hot wallet capped at ~48h of expected
  withdrawal volume**; everything else sits in the Squads multisig.
- **Withdrawal friction by design:** min withdrawal 5,000 $SHINY; 5% fee → treasury; queue
  processed every 30 min; auto-pay under per-user daily threshold (e.g., 250k), manual review
  above; 24h cooldown after primary-wallet change; global daily cap with circuit breaker.
- **Proof of reserves:** public endpoint comparing on-chain (hot + multisig) holdings vs sum of all
  player game balances, refreshed every 10 min. Liabilities ≤ reserves, always, visibly.
- **Deposit attribution:** each user gets a unique memo code; deposits are `transferChecked` to one
  deposit ATA with memo, OR (simpler UX) per-user derived deposit addresses swept hourly. Decision:
  **memo-based to a single address** — fewer keys, sweeping complexity removed; frontend builds the
  tx for the user so the memo is never typed by hand.

## Build checklist
- [ ] Deposit flow: build-tx endpoint, Helius webhook ingest, confirmation depth, ledger credit
- [ ] Idempotent ingestion (tx signature unique) + reorg safety (finalized commitment)
- [ ] Withdrawal queue: request → validate → fee split → review rules → signer worker → confirm
- [ ] Hot wallet management: balance monitor, auto-alert to top-up from multisig, hard cap
- [ ] Circuit breakers: pause-all-withdrawals flag, per-user freeze, daily global cap
- [ ] Proof-of-reserves endpoint + public page
- [ ] Runbooks: hot wallet compromise, stuck queue, webhook outage

## Claude Code prompt

```
In the trash-wars monorepo, implement the Bank module: on-chain $SHINY deposits and withdrawals
bridging to the in-game double-entry ledger (LedgerService from packages/db).

CONFIG (env): SHINY_MINT, DEPOSIT_ADDRESS (its ATA), HOT_WALLET_KEYPAIR_PATH, HELIUS_API_KEY,
WITHDRAWAL_FEE_BPS=500, MIN_WITHDRAWAL=5000_000000 (6 decimals), AUTO_PAY_DAILY_LIMIT,
GLOBAL_DAILY_WITHDRAWAL_CAP.

DEPOSITS
1. POST /bank/deposit-intent -> returns {depositAddress, memo} where memo = short unique code
   bound to the user (table deposit_memos). Also return a serialized unsigned transaction
   (transferChecked of user-specified amount + memo program instruction) the frontend can have
   the wallet sign — so memo correctness is guaranteed.
2. Helius webhook POST /webhooks/helius (verify auth header): on SHINY transfers to
   DEPOSIT_ADDRESS, parse memo -> user; insert deposits row keyed by tx signature (unique,
   idempotent); only credit when commitment=finalized: LedgerService.postTransaction(
   [+amount user game_balance, -amount deposits_pending? no — model as +user, +system
   deposits_clearing contra], idempotencyKey=tx_sig). Implement the double-entry pair as:
   debit system account 'onchain_reserve_mirror', credit user 'game_balance'.
3. Poller fallback job (every 60s) using getSignaturesForAddress to catch missed webhooks;
   same idempotent path. Deposits without a valid memo go to an 'unattributed' review table
   with admin endpoint to assign.

WITHDRAWALS
4. POST /bank/withdraw {amount, destAddress}: guards — authed, ToS, complianceGate, destAddress must be
   the primary wallet, no primary-wallet change in last 24h, amount >= MIN_WITHDRAWAL,
   user balance sufficient INCLUDING amounts locked in active missions (locked balance =
   sum of stakes on missions in state=active). Compute fee = amount * 500/10000.
   Ledger immediately: user -amount, treasury +fee, system 'withdrawals_payable' +net.
   Insert withdrawals row state=queued (or state=review if over AUTO_PAY_DAILY_LIMIT for
   this user today, or if user has sybil/security flags).
5. Withdrawal worker (BullMQ, every 30 min): respects global pause flag (config table) and
   GLOBAL_DAILY_WITHDRAWAL_CAP; for each queued item: build transferChecked from hot wallet,
   send, confirm finalized, mark sent with tx_sig; on failure -> state=failed with reason,
   ledger NOT reversed automatically (admin decides: retry or refund via explicit endpoint).
   If hot wallet balance < next payout: pause queue, fire alert (webhook to Discord admin
   channel) with required top-up amount.
6. Admin endpoints: approve/deny review items (deny refunds net+fee to user balance),
   pause/resume withdrawals, freeze user, view queue.

PROOF OF RESERVES
7. Job every 10 min: read on-chain balances (hot wallet ATA + multisig ATA via RPC), read
   total player liabilities = SUM(game_balance accounts) + withdrawals_payable; write a
   reserves_snapshots row. GET /public/proof-of-reserves returns latest snapshot + history.
   If liabilities > reserves: auto-pause withdrawals + alert (this should be impossible;
   treat as incident).

TESTS
- Deposit idempotency: same webhook delivered 5x credits once.
- Withdrawal cannot exceed unlocked balance; fee math exact at boundaries.
- Pause flag halts worker mid-queue safely.
- Reserves invariant test with seeded data.

SECURITY NOTES IN CODE REVIEW: hot wallet key only in worker process env, never in api;
all amount math in bigint; no floating point anywhere in money paths.
```

## Acceptance criteria
- Devnet end-to-end: deposit credits in <60s, withdrawal pays in next cycle, fee lands in treasury
- Proof-of-reserves page shows liabilities ≤ reserves continuously
- Kill switch works while queue is mid-flight
