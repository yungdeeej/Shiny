# Feature: Street Cred (Holder Tiers)        Season: S1 wk0 (LAUNCH)   Branch: feat/street-cred

## Why (KPI this moves)
Net DEX flow (KPI #6) and D30 retention. Creates a permanent, utility-based reason to buy and
hold $SHINY on secondary. Holdings are wallet-held (on-chain), not deposited — buy pressure stays
visible on the chart and off the game's books.

## Player-facing behavior
Five tiers resolved from the user's **primary wallet on-chain $SHINY balance** (held, not staked,
not deposited):

| Tier | Held $SHINY | Perks |
|---|---|---|
| Alley | 10,000 | Free-tier mission access (absorbs/replaces the existing free-tier holding gate) |
| Block | 50,000 | +1 concurrent mission slot (base 1 → 2), 10% off bail |
| District | 250,000 | Withdrawal fee 5%→4%, 1h early access to mint waves, exclusive nameplate cosmetic |
| Borough | 1,000,000 | +2 mission slots total (→3), fee→3%, 1 free raffle ticket/week, all District perks |
| Kingpin | 5,000,000 | Access to "The Penthouse Job" location (S1 wk8+, best EV curve), fee→2%, seasonal council vote, all Borough perks |

UI: tier badge next to balance pill; /me shows tier, next tier, and shortfall ("Hold 14,200 more
$SHINY to reach Block"). Tier page explains perks with a buy-on-Jupiter deep link.
Copy rule: perks are framed as *status and access*, never as yield or returns.

## Economy impact
- No emissions impact (perks are slots/fees/access, not payouts).
- Withdrawal fee discounts reduce treasury rake slightly — sim with 20% of withdrawal volume at
  District+ → acceptable (<0.8% rake reduction); discounts are also a retention lever on whales.
- Sim scenario: add holder-tier distribution to archetypes; verify free-tier behavior unchanged
  for Alley and that extra mission slots at Block+ don't breach the emissions guard at 2k DAU.

## Data model changes
- `tier_snapshots` (user_id, wallet, balance, tier, snapshotted_at) — daily job + on-demand.
- `users.current_tier` (denormalized, refreshed by job and on login).
- config table `tier_definitions` (tier, min_balance, perks jsonb) — hot-tunable downward-only
  for thresholds? No: thresholds may move EITHER way but only with 7-day public notice
  (pending_change row, like the emissions ratchet but bidirectional with notice).

## API changes
- `GET /me` → add { tier, nextTier, shortfall, perks }.
- TierService: resolve(wallet) reads on-chain ATA balance (Helius RPC, 5-min Redis cache);
  resolveCached(userId) for hot paths.
- Perk enforcement hooks: mission creation (slot count = f(tier)), withdrawal fee calc
  (bps = f(tier)), bail price, mint-wave open time check, raffle weekly grant job, location
  access guard (penthouse).
- Anti-flicker rule: tier DOWNGRADES apply after 24h below threshold (grace window);
  upgrades apply immediately. Prevents balance-shuffling griefs around fees.

## Frontend changes
- Tier badge component (balance pill), /cred page (tier ladder, perks, shortfall, history),
  early-access countdown state on mint event banner for District+.

## Out of scope
- Tier-gated cosmetic drops (S2), council voting mechanics (ship the vote UI S1 wk12, votes
  advisory only in S1).

## Acceptance criteria
- [ ] Tier resolves correctly from on-chain balance within 5 min of a wallet change; downgrade
      grace window works
- [ ] Block user can run 2 concurrent missions; Alley cannot run 2 (test both)
- [ ] District withdrawal charged at 4.00% exactly (bigint boundary test)
- [ ] District user can mint during early-access hour; Block user rejected until public open
- [ ] Borough weekly raffle ticket granted exactly once/week (idempotent job)
- [ ] Threshold change without 7-day notice rejected at API
- [ ] /cred page renders all states incl. no-wallet and sub-Alley

## Claude Code prompt
```
Implement the Street Cred holder-tier system in the trash-wars monorepo per this spec.
[PASTE: Player-facing behavior, Data model, API changes, Acceptance criteria sections.]
Integration points that already exist: free-tier holding check in mission creation (doc 06) —
replace its raw 10k check with TierService gate at Alley; withdrawal fee constant (doc 05) —
make it f(tier); mint event open check (doc 07); raffle grants (doc 11). 
Respect CLAUDE.md invariants. All fee math bigint. Write tests for each acceptance criterion.
Update CHANGELOG.md. Run the full test suite and the economy sim; summarize anything failing.
```
