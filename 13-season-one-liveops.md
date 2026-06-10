# 13 — SEASON 1 PLAYBOOK & LIVE-OPS SYSTEM

> **AMENDED (v1.1):** updated after the initial Claude Code build began.
> Deltas + reconciliation prompt: see **14-launch-scope-amendments.md**.

Covers: the full S1 calendar, the season-by-season learning loop, token demand engineering,
team revenue catalog, and the ongoing Claude Code development process.

---

## 1. SEASON 1: "FIRST SCORE" — 90 days, 210M $SHINY budget

**Principle (stolen from The Heist):** launch with ~40% of S1 content; drip the rest weekly.
Every week has exactly one headline. Never ship two tentpoles in one week — save it.

### Week-by-week calendar

| Wk | Headline drop | Also live / notes | Economy beat |
|----|---------------|-------------------|--------------|
| 0 (TGE) | Alpha Vault → DAMM → **deposits + missions live in 24h** | 3 locations live. **Launch features: Street Cred tiers (specs/01), Season Pass on sale (specs/02), Progressive Jackpot accruing + 2M seed, counter on map & landing (specs/03)** | Emissions at 60% of daily cap (ramp) |
| 1 | **Raccoon Mint Wave 1** (burn 25k each, supply ~1,500, announced 5 days ahead) | First weekly burn thread Sunday — no exceptions, ever | First big burn number |
| 2 | Stat upgrades unlock + **Armored Truck** opens | Insurance purchasable; verifier page promoted ("check our math") | Upgrade burn curve starts |
| 3 | **Recruitment Raffle Wave 1** (tickets 1k, burned) | Daily login fragments on | Raffle burn spike |
| 4 | **BLOODHOUND PD ACTIVATION** — cop mint (capped), patrols, heat, confiscation | Mid-season tentpole. "The cops eat what you lose" campaign | Redistribution yield begins |
| 5 | Cosmetics store opens (SHINY rail + first SOL premium drop) | Bribes live (heat counterplay) | New burn category |
| 6 | **First National** opens + Heat Wave Weekend #1 (48h boosted-multiplier event — distinct from the Progressive Jackpot) | First "Most Wanted" leaderboard (most confiscated raccoon gets a bounty cosmetic) | Controlled emissions spike, capped |
| 7 | **Hideout NFT Wave 1 (SOL)** + Tournament #1 (7-day profit ladder, entry 2.5k SHINY) | "Vault opens in 7 days" countdown campaign begins | Tournament rake begins |
| 8 | **THE MINT opens — the Jackpot becomes WINNABLE** (8 weeks of accrued pool on the line) + Penthouse Job opens (Kingpin tier) | Sentinel "vault opening" story arc | The number-go-up machine pays |
| 9 | Raccoon Mint Wave 2 (smaller, higher price 32.5k — scarcity ratchet) | Street Cred snapshot event for an exclusive wk10 drop (announced 7 days ahead → buy window) | |
| 10 | Heat Wave Weekend #2 + 1/1 Legendary auction (SOL) | Crows ARG begins: crow silhouettes appear on the map, Sentinel "strange birds" stories | |
| 11 | "Most Wanted: Citywide" event — PD vs Raccoons faction war week, winning faction splits a prize pool | S2 teaser trailer | Redistribution showcase |
| 12 | **Season Finale: THE BIG SCORE** — citywide co-op heist meter (aggregate stakes unlock a shared multiplier day), prestige rewards minted | S2 "Murder of Crows" reveal + emissions step-down framed as **The Halving** | |
| 13 | Dead week by design: retro, tuning, S2 final sim | Off-season mini-event only if retention cliffs | Budget remainder → reserve |

**Pre-announced, immovable:** weekly burn thread (Sun), Monday stats thread, biweekly town hall.
**Flexible:** event weekends shift ±1 week based on retention data — the calendar serves the KPIs.

---

## 2. ONE SEASON AT A TIME — the learning loop

Build S1 completely; S2 exists only as teasers + a design doc. Formal gate at day 75:

### Season Retro — the 7 KPIs
1. D7 / D30 retention (cohort by entry week)
2. Net daily inflation (emissions − burns) as % of circulating — target ≤ +0.15%/day by day 60
3. Redistribution share: % of gross player earnings from PvP redistribution vs emissions — target ≥30% trending up
4. Withdrawal/deposit ratio (weekly) — sustained >1.3 = extraction regime, act
5. Mint wave sellout time + raffle ticket volume (burn appetite)
6. Net DEX flow (buys − sells, 7d) around events — did Street Cred snapshots and wave announcements actually produce buy pressure?
7. Team revenue run-rate (SOL + rake) vs infra+ops cost

### The simulator bridge (your unfair advantage)
Days 75–90: refit `packages/economy` archetype parameters to observed S1 behavior (actual
missions/day, actual extraction rates, actual whale counts) → run S2 candidate configs through
180-day sims → only the surviving config ships. The Heist tuned live and apologized publicly;
you tune in silico and announce confidently. **Rule: no S2 number is final before the refit sim
passes.** Document each season's retro in docs/retros/ — by S3 you have a proprietary dataset
nobody else in the niche has.

---

## 3. TOKEN DEMAND ENGINEERING — why people buy on secondary

Audit of the base build: strong sinks, weak *acquisition* reasons. Sinks make holders not sell;
they don't make non-holders buy. Four additions:

### 3.1 Street Cred (holder tiers) — the big one — LAUNCH FEATURE (specs/01)
Perks keyed to **wallet-held** $SHINY (held on-chain, NOT deposited — so it's off the game's
books and visibly on the chart):

| Tier | Held $SHINY | Perks |
|---|---|---|
| Alley | 10k | Free-tier mission access (this tier IS the free-tier gate at launch) |
| Block | 50k | +1 concurrent mission slot, 10% off bail |
| District | 250k | Withdrawal fee 5%→4%, early mint-wave access (1h), exclusive nameplate |
| Borough | 1M | +2 mission slots, fee→3%, guaranteed raffle ticket weekly, District perks |
| Kingpin | 5M | Access to **The Penthouse Job** (exclusive location, best EV curve), fee→2%, vote in seasonal council |

Snapshot daily (Helius DAS / RPC balance reads, 5-min cache). Announce tier *snapshot dates* for
special perks 7 days ahead → creates scheduled buy windows. Implementation: extend doc 04's /me
with tier resolution; gate checks in mission/mint/withdraw paths.

### 3.2 The Mint Progressive Jackpot — LAUNCH FEATURE: accrues day 1, winnable wk8 (specs/03)
5% of every lost stake (split 45% burn / 50% PD / 5% jackpot) feeds a public pool from day 1,
plus a 2M TGE seed. Displayed huge on the city map (boarded-up Mint, "OPENING SOON") and the
public landing — visible to non-players. It becomes winnable when The Mint opens (wk8): the 12×
outcome also wins the pool. Eight weeks of a climbing counter IS the marketing campaign for The
Mint's opening. A perpetually growing public number is the strongest organic acquisition loop in
gambling-adjacent design.

### 3.3 Revenue-funded buyback policy (published)
Commit publicly: **25% of all SOL revenue (Season Pass, premium cosmetics, royalties) market-buys
$SHINY weekly and burns it**, executed via the doc 09 buyback bot, announced in the burn thread.
Your team revenue becomes visible chart support — holders literally profit from your monetization,
which neutralizes the "team extracting" narrative entirely.

### 3.4 Scheduled scarcity
Mint waves and raffle waves announced ≥5 days ahead with exact supply and price. Rational players
front-run your own sinks → pre-event buy pressure. Wave prices ratchet up within a season
(25k → 32.5k → 40k) — published curve, "earliest is cheapest."

**What NOT to add:** passive single-sided staking APY. It's an emissions drain with zero gameplay,
and it's the feature that most resembles a security. Street Cred gives the "reward for holding"
feeling through utility instead of yield.

---

## 4. TEAM REVENUE CATALOG

Iron rule: **SOL buys flex + convenience. $SHINY burns buy power.** Never sell stats for SOL.

| # | Stream | Price rail | Cadence | Notes |
|---|---|---|---|---|
| 1 | Withdrawal tax 5% | SHINY (treasury) | continuous | Existing — the rake |
| 2 | Marketplace fee (5% of the 10%) | SHINY | continuous | Existing |
| 3 | **Season Pass** (LAUNCH — specs/02) | SOL (~0.3 SOL) | per season | Free + premium track: cosmetics, insurance vouchers, raffle fragments, XP-style "Heat Meter" with weekly challenge unlocks. The proven whale-and-minnow monetizer. Build spec: new module `pass` — tracks challenge completion off mission events, premium purchase via doc 11's SOL-confirm flow |
| 4 | Premium cosmetic drops | SOL | bi-weekly | Small catalog, seasonal exclusives, collab skins later |
| 5 | **Hideout NFTs** (dens) | SOL | wave per season | Customizable hideout page: trophy display, character roster showcase, +2 cosmetic storage slots. Vanity real estate — never EV-affecting |
| 6 | 1/1 Legendary auctions | SOL | 1–2 per season | Hand-finished art, auctioned in Discord/on-site; pure margin + content moment |
| 7 | Secondary royalties | SOL | continuous | 4% on the Core collection (enforced via Core royalties plugin); characters + hideouts |
| 8 | Tournament rake | SHINY | per event | Entry-fee pools: 80% prizes, 10% burn, 10% treasury |
| 9 | Insurance bundles & convenience | SOL or SHINY | continuous | SOL-priced 10-pack insurance vouchers (convenience, not power — insurance exists in SHINY anyway), vanity name reservations, den themes |

Projection discipline: model #1–2 from sim volume, #3–7 from DAU × ARPPU comps (web3 games run
$2–8 ARPPU monthly); revisit at the day-75 retro. 25% of SOL streams route to the §3.3 buyback.

---

## 5. LIVE-OPS DEVELOPMENT PROCESS (you + Claude Code)

### 5.1 Repo conventions (one-time setup)
- **`CLAUDE.md` at repo root** — the standing brief every session reads. Contents:
  architecture map (doc 00 diagram), the invariants (all money in bigint; every balance change
  through LedgerService double-entry with idempotency key; odds-at-stake-time honored; emission
  changes downward-only without timelock; no new dependency without note), pointers to
  packages/economy as the single source of truth for game math, test commands, and
  "definition of done" (tests + sim pass + CHANGELOG entry).
- `docs/` — these 15 files (00–14), updated as decisions change (docs are the spec of record).
- `specs/` — one .md per new feature (template below). `docs/retros/` — season retros.
- CI gate: **economy-sim regression job** — any PR touching packages/economy, mission logic, or
  sink prices re-runs the 3 standard scenarios and fails if budget exhaustion or inflation
  thresholds breach. This is what lets you ship economy changes weekly without fear.

### 5.2 The weekly cycle
| Day | Activity |
|---|---|
| Mon | Telemetry review (doc 09 dashboard + KPI sheet), pick the week's drop from the calendar, write/refine its spec .md |
| Tue–Wed | Claude Code session(s) on a feature branch per spec; sessions are spec-driven, not vibes-driven |
| Wed | CI + sim gate → staging (devnet) → self-QA on phone |
| Thu | Ship to prod + patch notes post (patch notes are *content* — write them in Sentinel voice) |
| Fri | No deploys. Community day: town hall prep, burn thread drafting, next week's spec outline |
| Sun | Burn thread publishes (automated draft from doc 09, human-approved) |

Hotfix exception: economy exploits ship immediately under the doc 09 kill-switch → fix → disclose
playbook.

### 5.3 Feature spec template (`specs/NN-feature-name.md`)
```
# Feature: <name>            Season: S1 wk<N>   Branch: feat/<slug>
## Why (KPI this moves)
## Player-facing behavior (exact, with copy)
## Economy impact (sinks/faucets touched, sim scenario to run, expected delta)
## Data model changes (tables/columns)
## API changes (endpoints, zod schemas)
## Frontend changes (screens/components)
## Out of scope
## Acceptance criteria (testable list)
## Claude Code prompt
<assembled from the above — paste the sections, add: "Respect CLAUDE.md invariants.
Write tests for each acceptance criterion. Update CHANGELOG.md.">
```
Writing the spec IS writing the prompt — the template makes them the same artifact. For big
features, split into ≤1-day prompts (schema+API first, frontend second, telemetry third).

### 5.4 Session hygiene
- One module per session; reference acceptance criteria explicitly; end every session with
  "run the full test suite and the economy sim; summarize anything failing."
- Parallel work: git worktrees (e.g., backend feature + frontend feature simultaneously) only
  when they don't share schema changes.
- Weekly `pnpm audit` + dependency review session; monthly "exploit hunt" session: prompt Claude
  Code to attack the money paths (race conditions, idempotency, negative amounts, free-tier
  bypass) and write regression tests for anything found.
- Keep a `DECISIONS.md` log (date, decision, reason) — it's the memory between sessions and the
  source for honest community comms.

---

## Acceptance criteria for this doc
- S1 calendar loaded into a tracking board with owners/dates before TGE
- CLAUDE.md, specs/ template, and the sim CI gate exist in the repo before week 1
- Street Cred, Season Pass, and Progressive Jackpot specs (specs/01–03) are LAUNCH-SCOPE: they
  ship before TGE on the critical path; reconcile the in-flight codebase via doc 14's prompt
- Day-75 retro booked in the calendar now
