# 00 — MASTER PLAN: Trash Wars (working title)

> A risk-based idle game on Solana, modeled on The Heist (Longwood Labs), rebuilt **token-first**.
> Token: **$SHINY** · Game: **Trash Wars** · City: **Shorefront City**
> Factions: **Raccoons** (robbers, 90%) · **Bloodhound PD** (cops, 10%) · **Crows** (Season 2)

---

## 1. The thesis

The Heist proved the loop (idle staking + probability tables + real loss + visible burns) but died because
its value was anchored in NFTs when the market rotated to tokens. We invert it:

- **$SHINY is the asset.** Fair-launched via Meteora. ~70% of supply reserved for in-game emissions.
- **NFTs are productive equipment, not the entry ticket.** Characters are minted *by burning $SHINY*.
  Free-to-start tier exists (token staking missions) so the funnel has no 6.75 SOL gate.
- **The business earns rake, not token dumps.** Zero team token allocation (the credibility flex that
  made $GOLD's vault fill in 20 min). Revenue = withdrawal tax (5%), marketplace fee (10%),
  cosmetics (SOL-priced), NFT mint share.

## 2. Architecture (one diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND  Next.js 14 (App Router) · wallet-adapter · Tailwind  │
│  Game UI: City map, Mission board, Den (inventory), Jail,       │
│  Store, Leaderboard, Bank (deposit/withdraw)                    │
└───────────────▲─────────────────────────────────────────────────┘
                │ REST + WebSocket (live events feed)
┌───────────────┴─────────────────────────────────────────────────┐
│  BACKEND  Node 20 / TypeScript / Fastify                        │
│  ├─ auth-service        SIWS (Sign-In With Solana), sessions    │
│  ├─ game-engine         missions, RNG (commit-reveal), accrual  │
│  ├─ economy-service     balances (ledger), sinks, emissions     │
│  ├─ nft-service         Metaplex Core mint/burn, stat registry  │
│  ├─ pvp-service         patrols, confiscation, jail             │
│  └─ admin-api           telemetry, kill-switches, tuning        │
│  Postgres 16 (source of truth, double-entry ledger)             │
│  Redis + BullMQ (mission timers, payout jobs, patrol ticks)     │
└───────────────▲─────────────────────────────────────────────────┘
                │ @solana/web3.js + Helius RPC/webhooks
┌───────────────┴─────────────────────────────────────────────────┐
│  ON-CHAIN (Solana mainnet)                                      │
│  ├─ $SHINY SPL token (Token-2022 NOT used — plain SPL, max      │
│  │   composability with DEXs/aggregators)                       │
│  ├─ Meteora: Alpha Vault (TGE) + DAMM v2 pool (liquidity)       │
│  ├─ Deposit wallet (hot, rate-limited) + Treasury (Squads        │
│  │   multisig, cold) — v1 custodial bridge w/ proof-of-reserves │
│  ├─ Burn address events (publicized)                            │
│  └─ Metaplex Core collection (characters), cNFTs optional later │
└─────────────────────────────────────────────────────────────────┘
```

**Custody decision (v1):** custodial in-game ledger with on-chain deposit/withdraw bridge — same as
The Heist and DeFi Dungeons. An Anchor escrow program is a v2 upgrade once volume justifies an audit.
Mitigation in v1: Squads multisig treasury, hot wallet capped at 48h of expected withdrawals,
published proof-of-reserves page, withdrawal queue with manual review above thresholds.

**RNG decision:** provably-fair commit-reveal (server seed hash published before mission, revealed
after). Cheap, verifiable, casino-grade trust without VRF cost. Switchboard VRF only for
high-stakes events (rekt rolls, jackpot ≥10x) if community demands it.

## 3. Repo layout (monorepo)

```
trash-wars/
├─ apps/
│  ├─ web/            # Next.js game client
│  └─ admin/          # internal dashboard
├─ services/
│  └─ api/            # Fastify backend (all services as modules)
├─ packages/
│  ├─ db/             # Drizzle ORM schema + migrations
│  ├─ economy/        # pure functions: probability tables, EV math, emissions
│  ├─ chain/          # Solana helpers: SIWS, transfers, Metaplex Core
│  └─ shared/         # types, zod schemas
├─ ops/               # scripts: burn bot, buyback, proof-of-reserves
└─ docs/              # these files
```

## 4. Build order & dependency graph

| # | Doc | Depends on | Est. effort |
|---|-----|-----------|-------------|
| 01 | Economy & tokenomics design | — | 2–3 days (spreadsheet + sim) |
| 02 | Meteora launch playbook | 01 | ops, runs parallel |
| 03 | Scaffold & infrastructure | — | 1 day |
| 04 | Auth, accounts, anti-sybil | 03 | 1–2 days |
| 05 | Vault: deposits/withdrawals | 03, 04 | 2–3 days |
| 06 | Game engine: missions | 01, 05 | 3–5 days |
| 07 | Characters & NFT mint-burn | 06 | 3–4 days |
| 08 | PvP: patrols & confiscation | 06, 07 | 2–3 days |
| 09 | Economy automation & telemetry | 05, 06 | 2 days |
| 10 | Frontend game UI | 04–08 | 5–8 days |
| 11 | Cosmetics, raffles, marketplace | 07, 10 | 3–4 days |
| 12 | Launch ops & community | 02 | continuous from T-30 |

Critical path to a playable closed beta: **03 → 04 → 05 → 06 → 10 (mission board only)** ≈ 2–3 weeks
of focused Claude Code sessions. TGE should not happen before closed beta is live — "playable on
day 1" was The Heist's single biggest credibility weapon.

## 5. Sequencing strategy (phases)

- **Phase 0 (T-45 → T-30):** economy sim signed off (doc 01), socials live, art pipeline started
  (your EduAd Studio FLUX pipeline can generate the entire teaser campaign — reuse it).
- **Phase 1 (T-30 → T-7):** closed beta on devnet with testnet $SHINY, Discord whitelist grind,
  Heist-style teaser cadence (doc 12).
- **Phase 2 (T-0):** Meteora Alpha Vault TGE → DAMM pool live → deposits open same day → missions
  open T+1.
- **Phase 3 (T+14):** first character mint event (burn $SHINY → Raccoon). First public burn
  announcement with numbers.
- **Phase 4 (T+30):** Bloodhound PD activation (PvP), confiscation live. Season 1 mid-content.
- **Phase 5 (T+90):** Season 2 — Crows faction, emissions step-down, marketplace.

## 6. Non-negotiable risk controls

1. **Legal review before TGE.** Probability-table payouts + a tradeable token = gambling-adjacent +
   possible security. Get a Canadian crypto/gaming lawyer's memo on entity structure (likely offshore
   entity operating the game, you as arms-length contractor) and ToS. Budget CAD $10–20k. This is
   the one task no .md prompt can do for you. Note: jurisdiction/access gating is handled by a
   separate external compliance system (out of scope for these docs) — leave a middleware hook
   for it and integrate before deposits open.
2. **Economy kill-switches** in admin from day 1: pause withdrawals, pause a location, clamp
   multipliers, freeze account. (Doc 09.)
3. **No team tokens.** Your upside = rake revenue + optional transparent vault participation
   (announced publicly, capped, e.g. ≤2% of vault).
4. **Proof-of-reserves page** live before deposits open.
5. **Emissions can be tuned down, never up** (one-way ratchet, published policy).

## 7. Budget snapshot (lean)

| Item | Est. |
|---|---|
| Art (character base + traits via FLUX pipeline + human cleanup) | $3–8k |
| Legal memo + ToS | $10–20k CAD |
| Infra (Helius, Railway/Fly, Postgres, Redis) | <$500/mo |
| Liquidity seed (DAMM, paired from vault proceeds) | from vault raise |
| Audit (defer — v1 has no custom program) | $0 v1 |
| Marketing/KOLs | discretionary; cadence > spend |

## 8. What each doc contains

Every numbered doc has: **Objective → Key decisions (made for you, with rationale) → Build
checklist → Claude Code prompt (paste-ready) → Acceptance criteria.** Run them in order; each prompt
assumes the previous tasks' code exists in the monorepo.
