# 01 — ECONOMY & TOKENOMICS DESIGN ($SHINY)

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
| Mission entry stake (token-tier missions) | player-set | at-risk (lost share burned 50% / PD pool 50%) |
| Jail bail (skip 24h) | 1,500 | 75% burn / 25% PD pool |
| Cosmetics (token-priced items) | varies | 100% burn |
| Raffle tickets (recruitment, cosmetics) | 1,000/ticket | 100% burn |
| Marketplace fee | 10% of sale | 50% burn / 50% treasury |
| **Withdrawal tax** | **5%** | **treasury (team revenue) — this is the rake** |
| Name change / den customization | 250–2,500 | burn |

### Faucets
1. Idle accrual: staked characters earn $SHINY/hr by location (from season budget).
2. Mission payouts: multiplier wins (from season budget).
3. PD confiscation pool: Bloodhounds earn **redistributed** Raccoon losses — zero-emission yield.
   This is the core sustainability upgrade over The Heist: a growing share of "yield" is PvP
   redistribution, not printing. Target: ≥30% of gross player earnings are redistribution by S2.
4. Free tier: wallet holding ≥10,000 $SHINY (not staked, just held) can run 1 token-stake mission
   per 8h. Funnel without an NFT gate; balance check also drives buy pressure.

### Mission probability tables (S1, character missions)

EV stated in payout-multiple of the at-risk stake. "Confiscation" = staked loot moves to PD pool.
"Rekt" tiers: items → equipped item lost; character → NFT burned (with 24h insurance window
purchasable pre-mission — another sink).

| Location | Duration | Win | Multiplier | Nothing | Arrest (24h jail) | Confiscation | Rekt | EV |
|---|---|---|---|---|---|---|---|---|
| Corner Store | 2h | 70% | 1.4× | 25% | 5% | 0% | 0% | 0.98 |
| Pawn Shop | 4h | 55% | 1.8× | 28% | 12% | 5% | 0% | 0.99 |
| Jewelry District | 6h | 45% | 2.4× | 25% | 18% | 10% | 2% items | 1.08→tuned |
| Armored Truck | 8h | 35% | 3.2× | 25% | 22% | 13% | 5% items | ~1.12 |
| First National | 12h | 25% | 5× | 25% | 25% | 17% | 6% char w/o insurance | ~1.25 |
| The Mint (jackpot) | 24h | 12% ×5 / 3% ×12 | — | 30% | 30% | 18% | 7% char | ~0.96–1.3 |

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
  50% of lost mission stakes are burned, 50% go to a PD confiscation pool paid to Bloodhound
  stakers pro-rata daily.
- Free tier: wallets holding >=10k $SHINY may run one token-stake mission per 8h (Corner Store
  table, stake = min(holding*0.1, 5k)).

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
  circulating by day 60, PD APR stays 15–60% band, treasury rake ≥1.5% of daily volume
- You can defend every number in a public AMA
