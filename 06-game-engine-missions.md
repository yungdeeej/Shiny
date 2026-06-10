# 06 — GAME ENGINE: MISSIONS, RNG & IDLE ACCRUAL

## Objective
The core loop: stake → timed mission → provably-fair resolution against probability tables →
payout/jail/confiscation/rekt → idle accrual for staked characters. Imports the pure functions from
`packages/economy` (doc 01) so the simulator and the live game share one source of truth.

## Key decisions (made)
- **Provably fair RNG (commit-reveal):** at mission start, server generates `serverSeed`, stores it,
  returns `sha256(serverSeed)` to the client; client supplies `clientSeed` (default random).
  Outcome = HMAC(serverSeed, clientSeed + missionId) mapped to the probability table. On resolution,
  serverSeed is revealed; anyone can verify. Public verifier page included. (Casino-grade trust,
  zero on-chain cost.)
- **Resolution at claim, computed at deadline:** outcome is deterministically fixed by the seeds at
  start; the mission resolves when `resolves_at` passes via a BullMQ delayed job — not when the
  player clicks — so timing exploits are impossible.
- **Stakes are locked, not deducted:** ledger moves stake to a per-mission escrow account; outcome
  job settles it. Losses: 50% → burn_pool, 50% → pd_pool (per doc 01).
- **Jail:** character status=jailed, jailed_until=+24h. Bail sink available. Jailed characters
  earn nothing.
- **Idle accrual:** staked (idle-at-location) characters accrue $SHINY/hr from the emissions budget
  account, rate per location/level, credited lazily on claim (compute from last_claimed_at —
  no per-minute cron writes).
- **Insurance (rekt protection):** purchasable pre-mission for rekt-capable locations
  (price = % of stake, burned). If outcome=rekt with insurance, character survives, items still lost.

## Build checklist
- [ ] Locations config loader (from `packages/economy` season config → locations table)
- [ ] Mission lifecycle: start → active → resolve (delayed job) → settle ledger → notify
- [ ] Commit-reveal seeds + public verification endpoint + verifier page
- [ ] Stat modifiers applied at resolution (stealth/muscle/luck per doc 01)
- [ ] Free-tier token missions (no character, holding-gated, 8h cooldown)
- [ ] Idle accrual lazy-claim
- [ ] Jail + bail
- [ ] Insurance purchase
- [ ] WebSocket events: mission_resolved, city_feed (anonymized big wins/rekts — the dopamine feed)
- [ ] Emissions budget guard: payouts draw from emissions_budget account; if a day's draw hits the
      daily budget, multipliers auto-clamp and admin is alerted (never IOU players)

## Claude Code prompt

```
Implement the mission engine in services/api/src/modules/game + services/worker, importing pure
resolution logic from @trash-wars/economy (resolveMission, season1 config). LedgerService for all
money movement. Characters table exists (doc 03 schema).

ENDPOINTS
1. GET /game/locations — active locations with probability tables, durations, min/max stake,
   current player counts (Redis counters), and which require a character vs free-tier.
2. POST /game/missions {locationSlug, characterId?, stake, clientSeed?} — guards: authed, ToS,
   complianceGate, character owned+idle (or free-tier rules: no characterId, wallet on-chain holding
   >= 10_000 SHINY verified via RPC with 5-min cache, last free mission >= 8h ago, stake <=
   min(holding*0.1, 5_000)). Locks stake: ledger user -> mission_escrow account. Generates
   serverSeed (crypto.randomBytes(32)), stores hash + seed (seed column encrypted at rest with
   a KMS/env key), returns {missionId, serverSeedHash, resolvesAt}. Schedules BullMQ delayed
   job resolve-mission at resolvesAt. Sets character status=on_mission.
3. Resolution worker: outcome = resolveMission(table, effectiveStats, hmacRng(serverSeed,
   clientSeed + missionId)). effectiveStats = base stats + equipped item modifiers (items in
   characters.stats jsonb for now). Settlements, all in ONE ledger transaction with
   idempotencyKey=missionId:
   - win: escrow -> user (stake * multiplier); the profit portion (payout - stake) is drawn
     emissions_budget -> escrow first; enforce daily emissions guard (see 5).
   - nothing: escrow -> user (stake returned).
   - arrest: stake returned, character jailed_until = now+24h, status=jailed.
   - confiscation: escrow -> 100% pd_pool (stake lost to cops).
   - rekt_items: stake split 50% burn_pool / 50% pd_pool; clear equipped items.
   - rekt_character: as rekt_items + character status=dead (if NFT-backed, mark for on-chain
     burn by nft-service); if mission has insurance=true, downgrade to rekt_items.
   Reveal: store serverSeed plaintext in mission_outcomes detail; emit websocket events.
4. POST /game/missions/:id/insurance — purchasable only before resolves_at - 5 min, price =
   configured bps of stake, ledger user -> burn_pool, sets insurance=true.
5. Emissions guard: system account emissions_budget is topped daily by a worker job moving
   dailyBudget from emissions_reserve (mirrors the weekly multisig stream). Resolution worker
   checks remaining daily budget before paying profit; if insufficient, clamp multiplier to
   available and write an incident row + Discord alert. Players never receive IOUs.
6. Idle accrual: POST /game/characters/:id/claim-idle — payout = ratePerHour(location, level)
   * hoursSince(last_claimed_at), capped at 24h uncollected, drawn from emissions_budget,
   subject to the same guard. Characters must be staked at a location (POST /game/characters/
   :id/station {locationSlug}) to accrue.
7. Jail: POST /game/characters/:id/bail — price from config, user -> 75% burn_pool / 25%
   pd_pool, clears jail.
8. Provably fair: GET /game/missions/:id/verify returns seeds+hash+algorithm description;
   build apps/web/app/verify page that recomputes the outcome client-side from revealed seeds.
9. WebSocket (fastify-websocket or socket.io): channel 'city-feed' broadcasting anonymized
   events: {type:'jackpot'|'rekt'|'arrest', location, multiplier?, amountBand}. Per-user
   channel for own mission resolutions.

TESTS
- Determinism: same seeds + stats => same outcome, matches @trash-wars/economy sim function.
- Ledger conservation on every outcome path (property-based test across 10k random missions).
- Free-tier cooldown + holding gate enforced; emissions guard clamps correctly when budget
  nearly exhausted; insurance downgrades rekt; double-resolution impossible (idempotency).
```

## Acceptance criteria
- 10k-mission property test: zero ledger leaks, outcome distribution within 1% of configured tables
- Verifier page validates real missions end-to-end
- City feed pumping events in the UI within 1s of resolution
