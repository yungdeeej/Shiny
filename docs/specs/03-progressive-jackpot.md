# Feature: Progressive Jackpot      Season: S1 wk0 accrue / wk8 winnable   Branch: feat/jackpot

> Reconstructed spec: docs 13 (§3.2) and 14 (deltas #1/#2/#6) reference `specs/03-progressive-
> jackpot.md`, which was not uploaded. Assembled from those docs; ASSUMPTION markers flag
> choices awaiting owner sign-off.

## Why (KPI this moves)
Organic acquisition (KPI #6 net DEX flow + top-of-funnel). A perpetually climbing public number,
visible to non-players on the landing page and the boarded-up Mint, is the strongest acquisition
loop in gambling-adjacent design. Eight weeks of counter IS the marketing campaign for wk8.

## Player-facing behavior
- A share of every lost stake feeds a public **jackpot pool** from day 1, plus a **2,000,000
  $SHINY TGE seed** (from the marketing tranche, seeded via in-game ledger — on-chain
  distribution unchanged, per doc 14 #6).
- The pool counter renders on the city map (The Mint boarded up, "OPENING SOON" + counter)
  and on the logged-out landing page. Live ticks via socket.
- **Winnable from wk8** (The Mint opens): The Mint's existing 12× jackpot outcome row ALSO
  wins the pool. Same mission roll, same commit-reveal — **no new trust surface**.
- Payout = pool balance minus a **10% reset floor** holdback (the pool never resets to zero).
- Winner gets a dedicated full-screen takeover + city-feed moment + Sentinel story.

## Economy routing (v1.1 §1, reconciled with the approved S1 v2 tune)
Doc 14 prescribes 45/50/5 burn/PD/jackpot — written against v1.0's 50/50 split, BEFORE the
owner-approved APR retune (PD share 0.5% to hold the 35–45% hound APR band). Reconciled split:

> **lossSplit = 94.5% burn / 0.5% pd_pool / 5% jackpot_pool**

This preserves the approved APR band and the jackpot's 5% slice; burn gives up the 5 points.
Conservation invariant extends to the new `jackpot_pool` system account. Sims must re-pass all
three scenarios; report the before/after inflation delta.

## ASSUMPTIONS (owner review)
- "12× outcome" predates the S1 v2 tune which set The Mint's jackpot row to **10×**; the pool
  win binds to The Mint's `jackpot` outcome row whatever its multiplier (currently 10×).
- Winnable-at: game-day 56 (wk8) via config (`jackpot_winnable_at`), admin-movable per the
  calendar's ±1wk flex. Beta time scale (60×) puts it ~22 real hours after boot; the in-browser
  demo compresses to ~15 real minutes (labeled) so testers can experience the win.
- Multiple concurrent Mint missions: first settlement wins the pool; later settlements that
  rolled jackpot get their 10× payout but the (post-floor) smaller pool — inherent and fine.

## Data model changes
- `jackpot_pool` system ledger account (extends `accounts.kind` enum + conservation tests).
- `jackpot_events` (id, kind enum[seed,win], mission_id null, user_id null, amount, pool_after,
  created_at).
- `locations.config.jackpotEligible` bool — true only for `the-mint`.
- config_kv: `jackpot_winnable_at`.

## API changes
- Settlement: loss outcomes route the 5% slice → jackpot_pool (same single atomic ledger txn).
  Jackpot-outcome wins at an eligible location after winnable-at: pool payout leg
  jackpot_pool → user (balance − 10% floor), jackpot_events row, feed event — all in the SAME
  idempotent transaction (`mission:{id}`).
- `GET /public/jackpot` — unauthenticated, cached 10s: { pool, winnable, winnableAt,
  lastWinner, hits, seeded }.
- Socket `jackpot_tick` throttled ≥10s.
- Day-0 seed: bootstrap ledger txn idempotency `jackpot-seed:s1` (2M from the marketing
  tranche mirror).

## Frontend changes
- **VaultWidget**: pool counter with odometer-style rolling digits; boarded-up Mint variant
  pre-winnable ("OPENING SOON — wk8"), unlocked variant after. On the city map + a slim
  landing/onboarding counter for logged-out visitors.
- Winner ResultTakeover variant: "THE VAULT IS YOURS" — distinct from the regular jackpot
  takeover (pool amount count-up dwarfs the 10× line).
- Transparency page: pool size + history of hits.

## Out of scope
Multiple jackpot tiers, jackpot raffles, cross-location eligibility (S2 candidates).

## Acceptance criteria
- [ ] Ledger conservation holds with jackpot_pool in the invariant (property test updated)
- [ ] 5% routing exact at bigint boundaries; indivisible remainders conserved
- [ ] Pre-winnable: Mint jackpot outcome pays multiplier only, pool untouched
- [ ] Post-winnable: outcome pays multiplier + (pool − 10% floor); pool resets to floor;
      idempotent under concurrent settlement (exactly one pool payout)
- [ ] Seed event posts exactly once across reboots
- [ ] /public/jackpot requires no auth; counter visible logged-out
