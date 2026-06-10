# Feature: Season Pass            Season: S1 wk0 (LAUNCH)   Branch: feat/season-pass

> Reconstructed spec: docs 13 (§4 row 3) and 14 (delta #4) reference `specs/02-season-pass.md`,
> which was not uploaded. This spec is assembled from every detail in those docs, with gaps
> filled per the template; ASSUMPTION markers flag choices awaiting owner sign-off.

## Why (KPI this moves)
Team revenue run-rate (KPI #7) and D30 retention. The proven whale-and-minnow monetizer.
25% of pass SOL revenue routes to the published buyback-and-burn (doc 13 §3.3).

## Player-facing behavior
- One pass per season. **Free track** (everyone) + **Premium track** (~0.3 SOL).
- XP ("Heat") accrues from playing: mission resolved, bail paid, raffle tickets bought,
  patrol shifts completed. A **Heat Meter** chip in the top bar shows level + progress.
- Levels unlock rewards on both tracks; premium rewards claimable only with the pass —
  **retroactively**: buy at level 30, claim all 30 premium rewards.
- **Weekly challenges** (rotating set, e.g. "Pull 5 jobs at Pawn Shop", "Survive First
  National twice") grant bonus XP.
- Iron rule (binding, from doc 13 §4): rewards are cosmetics, insurance vouchers, raffle
  fragments, nameplates — **never $SHINY amounts, never stat effects.** Enforced by a config
  validation test.

## ASSUMPTIONS (owner review)
- 50 levels; XP curve 100 XP/level flat. XP rules: mission resolved 20 (win or lose — play is
  play), bail paid 10, raffle ticket 5 (cap 25/day), patrol shift completed 15, daily first
  mission bonus 30. Weekly challenges 150 XP each, 3/week.
- Reward cadence: free track every 5 levels, premium every level; premium-exclusive cosmetic
  at 10/25/50; insurance vouchers (free single-mission insurance, max 3 held) at premium
  5/15/20/30/40; raffle fragments elsewhere.
- Beta: SOL rail is not live, so premium is purchasable with play-money via a BETA-labeled
  button (`BETA-PASS-*` receipt). Devnet/mainnet: doc 11's SOL-confirm flow (unsigned transfer
  to the revenue wallet → confirm by tx signature, idempotent).

## Economy impact
None on the token economy (no SHINY sinks/faucets). Insurance vouchers substitute small
insurance burns — negligible; noted for the sim only.

## Data model changes
`season_passes` (user_id, season, premium bool, purchased_at, tx_sig null),
`pass_progress` (user_id, season, xp, level, UNIQUE(user_id, season)),
`pass_challenges` (id, season, week, slug, description, kind, target, xp),
`pass_challenge_progress` (user_id, challenge_id, progress, completed_at null),
`pass_rewards` (id, season, level, track enum[free,premium], kind enum[cosmetic,
insurance_voucher, raffle_fragments, nameplate], ref_slug null, amount null),
`pass_claims` (user_id, reward_id, claimed_at, UNIQUE(user_id, reward_id)),
`insurance_vouchers` (user_id, count) or a column on users — implementor's choice.

## API changes
- `GET /pass` → state (level, xp, premium, rewards w/ claimed flags, this week's challenges).
- `POST /pass/buy` (beta rail) / `POST /pass/confirm {txSig}` (SOL rail).
- `POST /pass/claim {rewardId}` — idempotent, premium-gated for premium track.
- Event fan-out: in-process bus (exists: `core/bus.ts`) emits pass-XP events from mission
  settlement, bail, raffle purchase, patrol end paths.
- Mission insurance endpoint accepts `useVoucher: true`.

## Frontend changes
- `/pass` page: Heat Meter hero, dual reward track rail (claimed/claimable/locked states),
  weekly challenges with progress bars, premium upsell with the iron-rule copy ("Flex, not
  power. SOL never buys stats.").
- Heat Meter chip in the top bar (level + XP ring), level-up toast.

## Out of scope
Collab cosmetics, gifting passes, pass XP boosts (never), S2 carry-over.

## Acceptance criteria
- [ ] XP accrues from each wired event exactly once (idempotent under settlement replays)
- [ ] Premium purchase is idempotent; retroactive claims unlock all earned premium rewards
- [ ] Free user cannot claim premium rewards (403), can claim free track
- [ ] Config validation test: no reward row may carry SHINY amounts or stat effects
- [ ] Weekly challenge rotation by season week; progress tracked and XP granted once
- [ ] Insurance voucher applies insurance without a burn, decrements exactly once
