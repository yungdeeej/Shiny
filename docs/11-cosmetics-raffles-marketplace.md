# 11 — COSMETICS, RAFFLES & MARKETPLACE

## Objective
The Heist's mid-game revenue + burn engines: a cosmetics store (flex economy), raffle systems
(their recruitment raffles burned tens of millions of NANA), and a P2P marketplace (10% fee =
rake + burn). These are the retention features that kept Heist's floor climbing post-launch.

## Key decisions (made)
- **Cosmetics:** two price rails — $SHINY-priced (100% burn; deflation engine) and SOL-priced
  premium drops (pure team revenue; small catalog, seasonal exclusives). Cosmetics attach to
  characters (hats, trench coats, masks, companions — "Lil Pepe companion" energy) and profiles
  (banners, name colors). Purely visual, never stats — stat-selling beyond the upgrade curve
  kills competitive trust.
- **Raffles, two types:**
  1. *Recruitment raffles* (Heist's signature): instead of open mints, waves of characters drop
     via raffle — tickets 1,000 $SHINY (burned), N winners mint free. Burns more than open mints
     at equal supply and creates event spikes. Use commit-reveal RNG + public verification.
  2. *Cosmetics raffles* for exclusive skins.
- **Marketplace (P2P, in-game):** list characters and cosmetics for $SHINY. 10% fee: 50% burn /
  50% treasury. In-game listing beats sending everyone to Tensor because the fee stays in the
  ecosystem — but characters remain externally tradeable too (liquidity optics).
- **Daily login ticket** (Heist did this): one free raffle-ticket fragment per daily login,
  5 fragments = 1 ticket. Cheap DAU lever.

## Build checklist
- [ ] Cosmetics catalog schema + inventory + equip system + render layers in CharacterCard
- [ ] Store endpoints (token rail → burn; SOL rail → payment via wallet tx verify)
- [ ] Raffle engine (commit-reveal winner draw, verifiable), recruitment + cosmetic types
- [ ] Marketplace: list/delist/buy with escrowed items, fee routing
- [ ] Daily login fragments
- [ ] Admin: catalog management, raffle scheduling, featured rotation

## Claude Code prompt

```
Implement store, raffles, and marketplace in services/api/src/modules/{store,raffles,market}
with frontend screens in apps/web. Ledger, characters, RNG utilities (commit-reveal from doc 06)
exist.

COSMETICS
1. Tables: cosmetic_items (slug, name, slot enum[hat,coat,mask,companion,banner,nameplate],
   rarity, price_shiny nullable, price_sol nullable, supply_cap nullable, season, art_uri),
   user_cosmetics (inventory, equipped_character_id nullable for character slots / user-level
   for profile slots).
2. POST /store/buy {itemSlug}: SHINY rail -> ledger user->burn_pool; SOL rail -> return an
   unsigned SOL transfer tx to the revenue wallet, then POST /store/confirm {txSig} verifies
   on-chain (finalized, exact amount, correct payer) before granting — idempotent on txSig.
   Supply cap atomic. Equip/unequip endpoints; equipped cosmetics included in character API
   payloads for rendering.

RAFFLES
3. Tables: raffles (type enum[recruitment,cosmetic], prize jsonb, ticket_price, max_tickets
   nullable, opens_at, draws_at, server_seed_hash, server_seed nullable, state),
   raffle_tickets (raffle_id, user_id, count). 
4. POST /raffles/:id/buy {count}: ledger user -> burn_pool (price*count); fragments:
   daily login grants login_fragments row (1/day, streak bonus at 7), 5 fragments auto-convert
   to a ticket on next purchase screen visit.
5. Draw worker at draws_at: winners = deterministic expansion of HMAC(serverSeed, raffleId)
   over weighted ticket entries (a user with 10 tickets has 10 entries; sample without
   replacement for multi-winner). Reveal seed, write winners, fulfill prizes (recruitment ->
   enqueue character mint jobs from doc 07 with price=0 path flagged raffle_grant; cosmetic ->
   grant inventory). GET /raffles/:id/verify mirrors the mission verifier.

MARKETPLACE
6. Tables: listings (seller_id, kind enum[character,cosmetic], ref_id, price, state).
   POST /market/list — character must be idle + inGame; listing escrows it (status=listed,
   cannot mission). POST /market/buy/:id — single ledger tx: buyer -price, seller +90%,
   burn_pool +5%, treasury +5%; transfer ownership rows; for characters also reassign
   owner_user_id (NFT stays frozen in-game; on-chain owner sync happens if/when unstaked —
   document this clearly in UI). Delist endpoint. Price history per item kind for charts.
7. Frontend: /store (rails clearly badged BURN vs PREMIUM), /raffles (live ticket counters,
   countdown, my tickets, past draws with verify links), /market (browse with filters,
   listing flow, price history sparkline).

TESTS
- SOL payment confirm rejects: wrong amount, wrong payer, reused sig.
- Raffle draw deterministic + matches verifier; without-replacement correctness.
- Marketplace buy is atomic under concurrent purchase attempts (one winner, one charge).
```

## Acceptance criteria
- A full recruitment raffle cycle on devnet with public verification passing
- Marketplace concurrent-buy race test: exactly one buyer charged
- Burn dashboard (doc 09) shows store/raffle/market contributions by category
