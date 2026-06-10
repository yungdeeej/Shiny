# 01 — ECONOMY & TOKENOMICS DESIGN ($SHINY)

> **AMENDED (v1.1):** loss routing now includes a 5% progressive-jackpot slice and holder-tier
> (Street Cred) gates touch this doc's mechanics. Deltas + reconciliation: see
> `14-launch-scope-amendments.md`; reconciled splits are recorded in `/DECISIONS.md`
> (94.5/0.5/5 — doc 14's 45/50/5 predates the owner-approved S1 v2 APR tune).


## Objective
Lock the full token economy before any code: supply split, emissions schedule, every sink, every
faucet, mission probability tables with EV math, and a simulation proving the economy survives
month 6. This doc is the spec; the Claude Code prompt builds the **economy simulator** to validate it.

## Key decisions (made)

### Supply: 1,000,000,000 $SHINY (plain SPL, 6 decimals)

| Allocation | % | Tokens | Notes |
|---|---|---|---|
| Game emissions reserve | 70% | 700M | Held by Squads multisig; streamed to game treasury per schedule below |
| Meteora Alpha Vault (TGE) | 12% | 120M | Fair launch, fixed price, pro-rata, no vesting |
| Liquidity + reserve | 10% | 100M | Seeds DAMM v2 pool paired with vault SOL; remainder = buyback reserve |
| Marketing / partnerships | 5% | 50M | KOL deals, quest platforms, exchange listings; 12-mo linear street |
| Community airdrops | 3% | 30M | Beta testers, Discord grinders, Heist/Remnants holder airdrop (poach the diaspora) |
| **Team** | **0%** | 0 | Credibility flex. Team revenue = rake (below) |

Launch circulating ≈ 12% + initial LP ≈ 15–17%. Target TGE FDMC: $2–4M (vault price set accordingly).

### Emissions schedule (the 700M) — decaying seasons, one-way ratchet down

| Season | Length | Emissions | Daily avg | Theme beat |
|---|---|---|---|---|
| S1 "First Score" | 90d | 210M (30%) | ~2.33M/day | Raccoons only → PD activates T+30 |
| S2 "Murder of Crows" | 90d | 140M (20%) | ~1.55M/day | Crows faction, marketplace |
| S3 "The Syndicates" | 90d | 84M (12%) | ~0.93M/day | Crews/guilds, territory |
| S4 "Lockdown" | 90d | 56M (8%) | | Prestige reset mechanics |
| S5+ reserve | — | 210M (30%) | | Future seasons / DAO vote |

Unemitted season budget rolls into reserve, never forward. Published as policy.

### Sinks (every one is a public burn or treasury-recycle event)

| Sink | Cost (S1 baseline) | Destination |
|---|---|---|
| Character mint (Raccoon) | 25,000 $SHINY | 100% burn |
| Character mint (Bloodhound, capped 10% of pop) | 60,000 $SHINY | 100% burn |
| Stat upgrade (per level, exponential ×1.35) | 500 base | 100% burn |
| Mission entry stake (token-tier missions) | player-set, per-location caps below | at-risk (lost share burned 99.5% / PD pool 0.5%) (tuned v2) |
| Mission insurance (rekt cover, pre-mission) | 16–28% of stake by tier (tuned v2) | 100% burn |
| Jail bail (skip 24h) | 1,500 | 99% burn / 1% PD pool (tuned v2) |
| Cosmetics (token-priced items) | varies | 100% burn |
| Raffle tickets (recruitment, cosmetics) | 1,000/ticket | 100% burn |
| Marketplace fee | 10% of sale | 50% burn / 50% treasury |
| **Withdrawal tax** | **5%** | **treasury (team revenue) — this is the rake** |
| Name change / den customization | 250–2,500 | burn |

> (tuned v2) Loss/bail routing dropped from 50%/25% PD shares to 0.5%/1% slivers: with
> bloodhound supply capped at 10% of characters, the 35–45% APR target on 60k mint
> capital only admits ~13k $SHINY/day of total hound income at 2k DAU — everything
> else burns. Patrolling shifts additionally collect a 1% bounty on confiscations on
> their beat (was 40%).

### Faucets
1. Idle accrual: staked characters earn $SHINY/hr by location (from season budget) —
   4 / 6 / 8 / 10 / 12 / 15 per hour up the tier ladder, +10% per character level (tuned v2,
   was 30–200/hr: idle alone exceeded the daily budget at 2k DAU).
2. Mission payouts: multiplier wins (from season budget).
3. PD confiscation pool: Bloodhounds earn **redistributed** Raccoon losses — zero-emission yield
   (0.5% of lost stakes + 1% of bail to the pool, plus the 1% patrol bounty; tuned v2 to hold the
   35–45% APR band). This is the core sustainability upgrade over The Heist: a growing share of
   "yield" is PvP redistribution, not printing. Target: ≥30% of gross player earnings are
   redistribution as season emissions taper (late S1 → S2).
4. Free tier: wallet holding ≥10,000 $SHINY (not staked, just held) can run 1 token-stake mission
   per 8h, stake = min(holding × 0.1, 500) (tuned v2, was 5,000). Funnel without an NFT gate;
   balance check also drives buy pressure.

### Mission probability tables (S1, character missions)

EV stated in payout-multiple of the at-risk stake. "Confiscation" = staked loot moves to PD pool.
"Rekt" tiers: items → equipped item lost; character → NFT burned (with 24h insurance window
purchasable pre-mission — another sink).

Table below is the shipped S1 config (tuned v2 — sim-validated at 2k DAU, seed 42: zero
clamp days, ≤+0.15%/day net inflation by day 60, bloodhound APR 35–38%). v2 keeps each
tier's EV anchor but trades multiplier for win% (lower emission cost per stake), and cuts
stake caps ~100x so saturated demand fits the 2.33M/day budget.

| Location | Duration | Win | Multiplier | Nothing | Arrest (24h jail) | Confiscation | Rekt | EV | Stake min–max | Idle/hr |
|---|---|---|---|---|---|---|---|---|---|---|
| Corner Store | 2h | 70% | 1.4× | 25% | 5% | 0% | 0% | 0.98 | 100–500 (tuned v2) | 4 |
| Pawn Shop | 4h | 65% (v2, was 55%) | 1.52× (v2, was 1.8×) | 18% | 11% | 6% | 0% | 0.99 | 250–750 | 6 |
| Jewelry District | 6h | 52% (v2, was 45%) | 1.94× (v2, was 2.4×) | 15% | 18% | 12% | 3% items | 1.01 (v2, was 1.08) | 400–900 | 8 |
| Armored Truck | 8h | 42% (v2, was 35%) | 2.45× (v2, was 3.2×) | 12% | 22% | 18% | 6% items | 1.03 (v2, was ~1.12) | 500–1,000 | 10 |
| First National | 12h | 25% | 4.2× (v2, was 5×) | 18% | 25% | 22% | 3% items + 7% char w/o insurance | 1.05 (v2, was ~1.25) | 600–1,000 | 12 |
| The Mint (jackpot) | 24h | 15% ×4.6 / 3% ×10 (v2, was 12% ×5 / 3% ×12) | — | 21% | 29% | 24% | 8% char | 0.99 | 750–1,250 | 15 |

Stats shift these: **Stealth** −arrest%, **Muscle** +multiplier, **Luck** +jackpot%, PD **Reputation**
+confiscation share. Tables are config rows in Postgres, hot-tunable from admin (doc 09), with the
constraint engine refusing any config where aggregate daily EV payout > remaining season budget /
remaining days × 1.1.

## Build checklist
- [ ] Confirm supply split + TGE FDMC target
- [ ] Confirm S1 sink prices (above) or adjust
- [ ] Build economy simulator (prompt below)
- [ ] Run 180-day sims at 500 / 2,000 / 10,000 DAU; confirm season budget never exhausts early and
      net inflation (emissions − burns) trends ≤ +0.15%/day of circulating by day 60
- [ ] Stress sim: 50% DAU crash at day 45 (does redistribution keep PD yield alive?)
- [ ] Stress sim: whale extracts daily (does withdrawal tax + sinks dampen?)
- [ ] Sign off table → freeze as `packages/economy/config/season1.ts`
- [ ] Write public-facing tokenomics page (Gitbook) from this doc, Longwood-style transparency

## Claude Code prompt

```
You are building the economy simulator for "Trash Wars", a risk-based idle game on Solana.
Create a standalone TypeScript package at packages/economy.

CONTEXT
- Token $SHINY: 1B supply. 700M game emissions reserve released over 4 seasons of 90 days:
  S1=210M, S2=140M, S3=84M, S4=56M. Daily season budget = season total / 90.
- Players stake characters (NFTs) at locations to run timed missions. Each mission risks a stake
  and resolves against a probability table. [PASTE THE LOCATION TABLE FROM DOC 01 HERE VERBATIM.]
- Sinks: character mint 25k (raccoon) / 60k (bloodhound, max 10% of character population),
  stat upgrades 500 * 1.35^level, jail bail 1.5k, raffle tickets 1k, cosmetics avg 800,
  withdrawal tax 5%. All burns except withdrawal tax (treasury) and the PD pool routing:
  99.5% of lost mission stakes are burned, 0.5% go to a PD confiscation pool paid to Bloodhound
  stakers pro-rata daily (tuned v2 — was 50/50; see POLICY.lossSplit).
- Free tier: wallets holding >=10k $SHINY may run one token-stake mission per 8h (Corner Store
  table, stake = min(holding*0.1, 500)) (tuned v2 — was 5k).

BUILD
1. packages/economy/src/config/season1.ts — typed config: locations, probabilities, multipliers,
   sink prices, emission budgets. Zod-validated. Include an invariant checker: reject any config
   where sum over locations of (expected daily payout at given DAU and avg stake) exceeds
   (remaining season budget / remaining days) * 1.1.
2. packages/economy/src/sim/ — an agent-based simulator:
   - Player archetypes: grinder (3 missions/day, never withdraws, upgrades stats),
     extractor (2 missions/day, withdraws 80% of profit daily), whale (10 characters,
     mixed behavior), tourist (free tier only, 20% convert to minting after 7 days),
     pd_farmer (mints bloodhound, stakes for confiscation yield).
   - Configurable population mix and DAU curve (growth, plateau, decay scenarios).
   - Each simulated day: resolve missions per tables, apply stat effects (stealth reduces
     arrest probability by 1.5% per level, muscle adds 2% multiplier per level, capped),
     route losses 50/50 burn/PD pool, pay idle accrual from emissions budget, process sinks,
     apply withdrawal tax, track every flow in a double-entry style ledger.
   - Outputs per day: circulating supply, cumulative burned, emissions spent vs budget,
     PD pool APR, net daily inflation %, treasury (rake) revenue in $SHINY, % of player
     earnings that are redistribution vs emission.
3. packages/economy/src/sim/report.ts — render results to a markdown report + CSV, and a
   simple chart (use a small dep like asciichart or write CSV for external charting).
4. CLI: pnpm sim --dau-curve growth --days 180 --players 2000 --seed 42 (deterministic seeds).
5. Tests (vitest): config invariants, probability tables sum to 1, ledger conservation
   (every token accounted: circulating + burned + unemitted + treasury + PD pool = 1B slice
   under sim), free-tier rate limiting.

CONSTRAINTS
- Pure TypeScript, no backend deps. This package will later be imported by the game engine,
  so keep probability resolution as pure functions: resolveMission(table, stats, rng) -> Outcome.
- Use a seedable RNG (e.g., a small xoshiro implementation), NOT Math.random.
- Strict TS, no any. pnpm workspace package named @trash-wars/economy.

DELIVER: working package, 3 scenario reports committed under packages/economy/reports/,
and a SUMMARY.md telling me which knobs are out of tune (e.g., "First National EV too high,
budget exhausts day 61 at 2k DAU — reduce multiplier to 4.2x").
```

## Acceptance criteria
- Simulator runs deterministic 180-day scenarios in <60s
- Ledger conservation test passes (no token leaks)
- A tuned `season1.ts` exists where: budget lasts ≥90 days at 2k DAU, net inflation ≤0.15%/day of
  circulating by day 60, PD APR settles in the 35–45% band (≥15% on staked hounds under DAU decay)
  (tuned v2 — was "15–60%"), treasury rake ≥1.5% of daily volume
- You can defend every number in a public AMA
