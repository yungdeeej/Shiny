# 08 — PVP LAYER: BLOODHOUND PATROLS & CONFISCATION

> **AMENDED (v1.1):** loss routing now includes a 5% progressive-jackpot slice and holder-tier
> (Street Cred) gates touch this doc's mechanics. Deltas + reconciliation: see
> `14-launch-scope-amendments.md`; reconciled splits are recorded in `/DECISIONS.md`
> (94.5/0.5/5 — doc 14's 45/50/5 predates the owner-approved S1 v2 APR tune).


## Objective
The cop faction's economy. Bloodhounds earn from **redistribution** (confiscated Raccoon losses),
not emissions — the structural fix that lets the game outlive its emissions schedule. Plus active
PvP: patrols that raise arrest/confiscation odds at targeted locations.

## Key decisions (made)
- **Passive yield:** the pd_pool (50% of all lost stakes + confiscations + bail/jail shares)
  distributes daily, pro-rata to staked Bloodhounds weighted by Reputation level. Zero emissions.
- **Active play — Patrols:** a Bloodhound owner assigns their hound to patrol a location for a
  6h shift. Effects while patrolled: location's arrest% +X and confiscation% +Y (X,Y scale with
  Reputation; capped aggregate shift per location so cops can't brick a location). Patrolling
  hounds earn a **bonus share** of that location's confiscations during their shift.
- **Counterplay:** Raccoon mission screen shows a "Heat" indicator per location (patrol density,
  not exact odds). High heat → smart raccoons route elsewhere → cat-and-mouse meta emerges.
  Optional Raccoon "Bribe" action: pay $SHINY (75% burn / 25% to the patrolling hounds) to reduce
  personal heat for one mission — a sink that literally pays the cops.
- **Why cops are 10% capped:** if cop yield = f(raccoon losses), cop population must be scarce or
  per-cop yield collapses. The cap + 60k mint price keeps Bloodhound APR premium — same logic as
  Heist's gorillas (10% of supply, +25% earnings) but funded by redistribution instead of emission.

## Build checklist
- [ ] pd_pool daily distribution job (pro-rata, Reputation-weighted)
- [ ] Patrol shifts: assign, conflict rules, aggregate caps per location
- [ ] Probability modifier pipeline: mission resolution reads live patrol state at start (snapshot
      into mission row — odds shown at stake time are the odds honored)
- [ ] Heat indicator API (banded, not exact)
- [ ] Bribe action
- [ ] City-feed events: big confiscations ("K9-Rex seized 41,000 $SHINY at First National")
- [ ] Anti-collusion: a hound patrolling cannot boost confiscation of stakes from wallets in its
      own sybil cluster (flag check) — prevents self-confiscation laundering of the burn half

## Claude Code prompt

```
Implement the PvP layer in services/api/src/modules/pvp + worker jobs. Mission engine (doc 06)
and characters (doc 07) exist. pd_pool is a system ledger account already receiving routed losses.

PATROLS
1. POST /pvp/patrols {characterId, locationSlug} — guards: faction=bloodhound, status=idle,
   inGame staked. Creates patrol row {shiftEnd = now+6h}. Per-location aggregate cap: total
   active patrol "weight" (sum of 1 + reputation*0.2) <= cap from location config; reject when
   full. Character status=on_patrol until shiftEnd (worker reverts).
2. Modifier snapshot: extend mission creation (doc 06) — at POST /game/missions, compute
   effectiveTable = base table adjusted by current patrol weight at that location:
   arrest% += min(weight * 0.8, capArrestShift), confiscation% += min(weight * 0.6, capConfShift),
   reduce 'win'% proportionally to keep table summing to 1. Persist effectiveTable into the
   mission row; resolution uses the persisted table (odds-at-stake-time honored). Show the
   adjusted table to the player BEFORE confirming the stake.
3. Confiscation routing: when an outcome routes tokens to pd_pool from a patrolled location,
   split: 40% to that shift's patrolling hounds pro-rata by weight (ledger directly to their
   owners' game_balance, tagged ref_type='patrol_bounty'), 60% to the global pd_pool.
   Anti-collusion: before paying patrol bounty, check sybil_flags — if the rekt/confiscated
   user shares a cluster with a patrolling hound's owner, that hound's share goes to global
   pd_pool instead, and write an audit_log entry.

PASSIVE DISTRIBUTION
4. Daily worker job: snapshot pd_pool balance, distribute 80% (keep 20% as buffer) pro-rata to
   all living, inGame-staked Bloodhounds weighted by (1 + reputation*0.25), via one batched
   ledger transaction. Write pd_distributions rows for the APR dashboard.

HEAT + BRIBES
5. GET /game/locations heat field: band patrol weight into none/low/med/high/blazing.
6. POST /game/missions/:id/bribe — pre-resolution only, price = configured bps of stake;
   ledger: 75% burn_pool, 25% split to current patrolling hounds at that location; effect:
   recompute THIS mission's persisted table removing 50% of the patrol-added arrest/conf
   percentages. One bribe per mission.

FEED + STATS
7. Emit city-feed events for confiscations > configurable threshold with hound name.
8. GET /pvp/stats — pd_pool size, trailing-7d Bloodhound APR, top hounds leaderboard.

TESTS
- Table adjustment always sums to 1 and never exceeds caps; persisted-odds honored even if
  patrols end before resolution.
- Distribution conservation: sum of payouts == 80% of pool snapshot exactly (bigint).
- Collusion path routes bounty to global pool. Patrol cap race test (concurrent assigns).
```

## Acceptance criteria
- A staged scenario on devnet: patrols visibly shift displayed odds; confiscation pays patrollers
- Bloodhound trailing APR endpoint live and matching ledger truth
- Collusion test demonstrates self-confiscation is unprofitable
