# S1 economy retune v2 — summary (2026-06-10)

Scenario harness: 180 days, 2,000 players, seed 42, mix grinder 35% / extractor 20% /
whale 5% (10 characters each) / tourist 30% / pd_farmer 10% (the adversarial cap).
All numbers below are from the committed reports (`growth-2000.md`, `plateau-2000.md`,
`decay-2000.md`).

## Why everything moved

Two hard constraints drove the retune:

1. **APR band.** 2,000 players × 10% pd_farmers = 200 bloodhounds × 60k mint = 12M
   SHINY of hound capital. A 35–45% APR therefore allows only **~11.5–14.8k SHINY/day**
   of total hound income — versus ~1.2M/day under the old 50/50 loss split (the 2,500%
   APR finding). The PD routing had to shrink ~100x, to thin slivers.
2. **Budget.** The 2.33M/day budget is ~1.17k SHINY/player/day of subsidy. Because the
   doc-EV convention keeps paying EV ≈ 1.0 with stake returned on nothing/arrest, the
   emission cost of a mission is `payingEV − win%` ≈ 30–80% of stake; players sit at
   stake caps almost immediately (bankroll ≫ cap). So the **stake caps are the demand
   dial**, and they had to come down ~100x to fit the budget without daily clamping.

## Final knobs (old → new)

### POLICY (packages/shared/src/constants.ts)

| Knob | Old | New |
|---|---|---|
| lossSplit (lost stakes) | 50% burn / 50% PD | **99.5% burn / 0.5% PD** |
| bailSplit | 75% burn / 25% PD | **99% burn / 1% PD** |
| patrolBountyBps | 4,000 (40% of confiscations) | **100 (1%)** |
| freeTierMaxStake | 5,000 | **500** |
| pdDailyDistributionBps | 8,000 | 8,000 (unchanged) |

(bailSplit.pdBps cannot be 0: the live bail handler posts the PD ledger leg
unconditionally and the ledger rejects zero deltas.)

### Location tables (packages/economy/src/config/season1.ts)

EVs are the doc-01 paying-row convention (win% × multiplier). Risk-ladder shape kept:
win% strictly falls, multiplier and conf/rekt strictly rise with tier.

| Location | Win × Mult (EV) old → new | Arrest | Conf | Rekt | Stakes old → new | Idle/hr old → new | Insurance |
|---|---|---|---|---|---|---|---|
| Corner Store | 70%×1.4 (0.98) → **unchanged** | 5% | 0% | 0% | 100–10k → **100–500** | 30 → **4** | — |
| Pawn Shop | 55%×1.8 (0.99) → 65%×1.52 (0.99) | 12→11% | 5→6% | 0% | 250–25k → **250–750** | 50 → **6** | — |
| Jewelry District | 45%×2.4 (1.08) → 52%×1.94 (1.01) | 18% | 10→12% | 2→3% items | 500–50k → **400–900** | 75 → **8** | 8% → 16% |
| Armored Truck | 35%×3.2 (1.12) → 42%×2.45 (1.03) | 22% | 13→18% | 5→6% items | 1k–100k → **500–1,000** | 100 → **10** | 10% → 20% |
| First National | 25%×5.0 (1.25) → 25%×4.2 (1.05) | 25% | 17→22% | 3% items + 7% char | 2.5k–250k → **600–1,000** | 140 → **12** | 12% → 24% |
| The Mint | 12%×5 + 3%×12 (0.96) → 15%×4.6 + 3%×10 (0.99) | 30→29% | 18→24% | 7→8% char | 5k–500k → **750–1,250** | 200 → **15** | 15% → 28% |

Corner Store's table is byte-identical to v1 (EV 0.98, the free-tier hook); only its
stake cap and idle rate moved. Mint prices stay 25k raccoon / 60k bloodhound.

### Sim engine fixes (documented assumption changes)

- **Idle accrual was overcounted**: each mission paid `(24 − duration)h` of idle, so a
  3-mission corner-store day paid 66 idle-hours on one character. Now capped at the
  player's true idle character-hours (`24 × characters − mission hours`).
- **Patrol bounty modeled**: 1% (POLICY.patrolBountyBps) of each confiscated stake at a
  patrolled location goes straight to the patrolling shift; the remainder routes
  through lossSplit.
- **APR metric fixed to the owner definition**: annualized (PD distributions + patrol
  bounties) / (living bloodhound count × 60k). A staked-hounds variant is also
  reported (`pdAprStakedBps`) — identical in growth/plateau, diverges in decay.
- Population mix, bankrolls, stake divisors, missions/day untouched — pd_farmer stays
  at the 10% adversarial cap, whales keep 10 characters each.

## Targets — measured (seed 42)

| # | Target | Growth | Plateau (1.2k DAU) | Decay |
|---|---|---|---|---|
| 1 | APR 35–45% steady; ≥15% decay | d60–89 **38.0%**, d90–138 36.1%, trailing-30d 35.2% | 36.6% / 35.4% / 35.4% | staked **35–36%** all windows ✓ · living 18%→6% (see risks) |
| 2 | Budget lasts 90d, clamp <5% of days | clamp **0/90**; 112.1M of 210M left at day 89 (exhausts day 174) | clamp 0/90; 119M left | clamp 0/90; 130M left |
| 3 | Net inflation ≤ +0.15%/day by day 60 | d60–89 avg **−0.42%**, trailing-30d −0.15% | d60–89 **+0.04%** | d60–89 +0.01% |
| 4 | Redistribution ≥30% by late S1 | **0.8% while emissions run; crosses 30% as the S1 reserve winds down (day ~174), 100% after** | same shape | same shape |
| 5 | Corner Store paying EV 0.98 | ✓ table unchanged | ✓ | ✓ |
| 6 | Mints 25k / 60k | ✓ unchanged | ✓ | ✓ |

Seed-7 cross-check (growth): APR 33.5–37.6%, inflation ≤ +0.08%, clamp 0/90.

## Residual risks & caveats

1. **Targets 1 and 4 are arithmetically incompatible while emissions run.** Gross
   earnings at 2k DAU ≈ 1.3M/day (emissions). A ≥30% redistribution share needs
   ≥560k/day of hound income, which on 12M of hound capital is ~1,700% APR. Holding
   the 35–45% band caps redistribution at ~1% of gross during full emissions. The 30%
   target is only reachable when emissions taper (here day ~174; structurally "late
   S1/S2" as the doc itself frames it). Making both hold simultaneously would need
   ~13,000+ bloodhounds — impossible at 2k players under the 10% cap.
2. **Decay APR on the strict living-hound basis falls to ~6%** by day 180: income
   scales with the ~200 remaining DAU while 115 minted hounds stay in the
   denominator. Hounds still actively staked earn 35–36% throughout (the sim pays
   distributions only to active patrollers). No routing value inside the approved
   35–45% steady band can hold ≥15% on the living basis (it would need ≥85% steady).
3. **`services/api` settle.ts is out of sync with the tuned spec** (source untouchable
   this pass): it hardcodes `PATROL_BOUNTY_BPS = 4_000` instead of reading
   `POLICY.patrolBountyBps`, and routes confiscations 100% to pd_pool instead of
   through `splitLoss`. **With live behavior the hound APR would blow past the band
   (~40x bounty, ~200x pool inflow). Both must be patched before launch** — two
   small diffs: import the POLICY constant, and apply `splitLoss` to the
   post-bounty confiscation remainder.
4. **If DAU halves** with hounds staying staked, hound income roughly halves → APR
   ~18% (still ≥15%). If DAU doubles to 4k with the farmer cap binding at 10%, APR
   roughly doubles (~70%) — the loss-split sliver (0.5%) or bounty (1%) should be
   ratcheted down via admin tuning (decreases apply immediately).
5. **Budget is deliberately underspent** at 2k DAU (~57% utilization, 1.33M/day
   demand): headroom for ~3.5k DAU before the clamp engages; the unspent remainder
   rolls to reserve per published policy.
6. **Post-S1 sink depletion**: once stat upgrades cap (level 10, ~day 90+), plateau
   net inflation drifts to ~+0.25%/day in the artifact window where the 180-day run
   keeps spending leftover S1 budget. S2 needs recurring sinks (cosmetics,
   marketplace) — flagged for the S2 retune, not an S1-window issue.
7. Free-tier identity changed: the cap is now 500 (was 5k) and corner-store stakes cap
   at 500 — "hold 10k, stake up to 500" is the new public copy (one hardcoded string
   in the web demo engine still says 5,000; cosmetic).
