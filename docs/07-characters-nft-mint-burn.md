# 07 — CHARACTERS: MINT-WITH-BURN NFTS, STATS & UPGRADES

## Objective
Your core idea: players burn $SHINY to mint Raccoons/Bloodhounds (Metaplex Core NFTs) that
multiply earning power. Characters carry stats, level via $SHINY burns, equip items, and can die
(NFT burned). This makes NFTs a token sink + yield position rather than the entry product.

## Key decisions (made)
- **Metaplex Core** (not legacy Token Metadata, not cNFTs for v1): single-account assets, cheap
  (~0.0029 SOL), plugin system (freeze/attribute plugins), tradeable on Tensor/Magic Eden
  immediately. cNFTs reconsidered only if minting >100k assets.
- **Mint = burn:** 25,000 $SHINY (Raccoon) / 60,000 (Bloodhound) deducted from game balance →
  burn_pool → batched on-chain burns (doc 09 publishes them). NFT minted by backend mint authority
  directly to the player's primary wallet, then **auto-deposited** (game reads it in-wallet; play
  requires it staked in-game via a freeze plugin — "In Wallet vs In Game" exactly like The Heist's
  NFTs Management screen).
- **Bloodhound cap:** mints blocked when Bloodhounds > 10% of living characters (scarcity = the
  cop-yield premium, per Heist's gorilla design).
- **Traits & art:** generative layer stack (you already run a FLUX pipeline — generate base + trait
  layers, human pass for cleanup). Rarity affects base stats within bands, never odds directly
  (keeps "pay-for-stats" honest: stats come from burns, rarity is flex + small base edge).
- **Death is real:** rekt_character → Core asset burned on-chain by the backend (asset has a
  permanent burn delegate plugin). Death events are content (The Heist's "first chimp is dead"
  moment) — the city-feed announces them.
- **Stats:** Stealth / Muscle / Luck (Raccoons), Reputation (Bloodhounds). Upgrade cost
  500 × 1.35^level, burned. Level cap per season (cap rises each season = returning-player hook).

## Build checklist
- [ ] Art pipeline: 1 base × ~8 trait layers × 2 factions; metadata JSON generator; Arweave/Irys upload
- [ ] Collection + mint authority setup (Core collection, authority on a dedicated keypair in worker)
- [ ] Mint flow: burn ledger entry → mint job → deliver → register character row ↔ asset id
- [ ] In Wallet / In Game staking via Core freeze plugin (or custodial transfer — decide with
      community optics in mind; freeze-in-wallet is strictly better optics)
- [ ] Upgrade endpoints (burn → stat++ with attribute plugin sync on-chain)
- [ ] Death → on-chain burn job
- [ ] Bloodhound cap enforcement
- [ ] Mint event scheduling (mints open in waves, not always-on — scarcity events drive burns)

## Claude Code prompt

```
Implement the character/NFT system in packages/chain + services/api/src/modules/characters +
worker jobs. Use @metaplex-foundation/mpl-core with umi. The game ledger and mission engine exist.

CHAIN PACKAGE (packages/chain/src/core.ts)
1. createCollection(name 'Trash Wars', uri) — one-time script in ops/.
2. mintCharacter({owner, faction, traits, stats, name}) -> creates a Core asset in the
   collection with: metadata uri (pre-uploaded), Attributes plugin holding
   {faction, level, stealth, muscle, luck|reputation, season}, PermanentFreezeDelegate +
   PermanentBurnDelegate set to the game authority (enables in-wallet staking + death burns).
3. setStaked(assetId, bool) -> toggles freeze. burnAsset(assetId) -> permanent burn.
4. syncAttributes(assetId, stats) -> updates Attributes plugin after upgrades.
   All functions: priority fees, retry w/ blockhash refresh, return signatures.

ART/METADATA (ops/art)
5. Script that takes layered PNG directories (faction/layer/trait.png), composes N unique
   combinations with weighted rarity from a rarity.json, renders 2048px images via sharp,
   writes Metaplex-standard metadata JSON (attributes incl. rarity tier), uploads via Irys,
   outputs a manifest mapping index -> uri + traits + statBands. Deterministic from a seed.

API (modules/characters)
6. GET /game/mint-events — active mint waves {faction, price, remaining, opensAt, closesAt}.
   Config table mint_events; Bloodhound waves auto-disabled if bloodhounds/living > 10%.
7. POST /game/mint {eventId} — guards: event open, supply remaining (atomic decrement in
   Redis + DB check), user balance >= price. Ledger: user -> burn_pool (price), idempotency
   on a mint_orders row. Enqueue mint job: pick next manifest index, call mintCharacter to
   user's PRIMARY wallet, insert characters row (nft_mint=assetId, stats from manifest
   statBands), mark order fulfilled. On chain failure after burn: order state=failed_retry,
   job retries; never refund automatically (admin endpoint exists) — funds were burned.
8. POST /game/characters/:id/stake-state {inGame: bool} — calls setStaked; only inGame
   characters can be stationed/run missions; toggling out requires status=idle.
9. POST /game/characters/:id/upgrade {stat} — cost = 500 * 1.35^currentStatLevel, ledger
   user -> burn_pool, increment stat (cap from season config), enqueue syncAttributes.
10. Death integration: subscribe to mission outcome rekt_character -> enqueue burnAsset,
    set characters.status=dead, emit city-feed 'death' event with character name.
11. Ownership reconciliation job (hourly, Helius DAS): if a living character's asset moved
    wallets (sold on Tensor while not staked), update owner_user_id by wallet->user lookup,
    or mark orphaned (new owner hasn't registered). Selling characters on secondary IS allowed
    and desirable — it's the player-to-player exit that protects the token from sell pressure.

TESTS
- Mint order idempotency under concurrent clicks; supply cannot oversell (race test).
- Bloodhound cap blocks at boundary. Upgrade pricing exact. Dead characters can't mission.
- Devnet integration test: full mint -> stake -> upgrade -> burn cycle.
```

## Acceptance criteria
- Devnet: mint wave of 50 sells out cleanly under load test, zero oversell
- Character tradeable on Tensor devnet listing while unstaked; frozen while staked
- A character death produces an on-chain burn + feed event
