# 02 — METEORA LAUNCH PLAYBOOK ($SHINY TGE)

## Objective
Execute the token generation event so that (a) only ~12% of supply hits the market at TGE,
(b) the launch is provably fair (no snipers, no insiders), (c) the 70% emissions reserve is
verifiably locked, and (d) liquidity is deep enough that day-1 trading doesn't 10x-then-rug itself.

## Key decisions (made)

1. **Mechanism: Meteora Alpha Vault → DAMM v2 pool.** This is the $GOLD playbook: deposits open
   for a fixed window at a fixed price, anti-bot, pro-rata if oversubscribed, excess refunded.
   NOT pump.fun (forces full supply through the curve), NOT a raw LP seed (gets sniped).
   Note: Meteora's products evolve (Alpha Vault, DBC, DAMM v2/DLMM) — verify current docs at
   docs.meteora.ag the week you configure; the *structure* below holds regardless.
2. **Vault terms:** 120M $SHINY at fixed price. Price = target raise / 120M.
   Target raise $300–500k SOL-denominated → implies TGE FDMC ~$2.5–4.2M. Deposit cap with
   pro-rata overflow. No vesting (instant claim) — vesting on a fair launch just delays the dump
   and poisons sentiment.
3. **Liquidity:** pair 60–80M $SHINY from the liquidity allocation with 60–70% of vault SOL
   proceeds into DAMM v2. LP position locked ≥12 months (Meteora lock or Streamflow), lock tx
   published. Remaining SOL → ops + buyback reserve (multisig).
4. **Emissions reserve custody:** 700M to a Squads multisig (3-of-5: you + 2 trusted + 2 hardware
   backups) — published address, labeled on Solscan. Streamed to the game hot treasury weekly,
   never more than 2 weeks of budget hot.
5. **Team participation:** if you buy into the vault, announce it beforehand and cap it (≤2% of
   vault). Transparency is the brand.

## Pre-TGE checklist (T-30 → T-0)
- [ ] Legal memo + entity signed off; external compliance/access system integration confirmed (hard gate — see doc 00 §6.1)
- [ ] Mint $SHINY: plain SPL, 6 decimals, mint authority → revoked after full supply minted,
      freeze authority → null. Publish mint address + authorities-revoked txs
- [ ] Metadata (Metaplex token metadata): name, symbol, logo, URI; immutable
- [ ] Squads multisig created; 700M transferred; address published
- [ ] Jupiter token list / verification submission prepared
- [ ] Alpha Vault configured (price, cap, window, whitelist=none); dry run on devnet
- [ ] DAMM v2 pool params decided (fee tier — start 1–2%, fees fund buyback)
- [ ] Proof-of-reserves page live (doc 09 ships the endpoint)
- [ ] Tokenomics Gitbook public ≥7 days before vault opens
- [ ] CEX/DEX trackers: CoinGecko + CMC applications drafted (submit T+1)
- [ ] Closed beta playable — **vault does not open until the game is live on devnet/mainnet-beta**
- [ ] Announcement thread + vault tutorial video recorded

## TGE-day runbook (T-0)
- [ ] T-0h: vault opens; pinned tutorial; mod team on shift schedule (scam-link nuking — The Heist
      got impersonator-swarmed within days of success, expect the same)
- [ ] T+24h: vault closes; pro-rata claims open
- [ ] T+24–26h: seed DAMM pool; lock LP; publish lock tx
- [ ] T+26h: trading live announcement; deposits into the game bank open
- [ ] T+30h: first missions go live ("playable within hours of TGE" is the headline)
- [ ] Day 2: publish raise breakdown — exactly where every SOL went (LP / ops / buyback reserve)

## Claude Code prompt (launch tooling)

```
Create ops/launch in the trash-wars monorepo: TypeScript scripts (run with tsx) for the $SHINY TGE.
Use @solana/web3.js v1.x, @solana/spl-token, @metaplex-foundation/umi + mpl-token-metadata.
All scripts take --rpc and --keypair flags, support --dry-run, and print explorer links.

SCRIPTS
1. 01-mint-token.ts — create mint (6 decimals), mint 1,000,000,000 to a provided authority ATA,
   attach metadata (name "Shiny", symbol "SHINY", uri from --metadata-uri, immutable),
   then revoke mint authority and verify freeze authority is null. Output a JSON manifest
   (mint address, txs) to ops/launch/out/.
2. 02-distribute.ts — reads a distribution.json: [{label, address, amount}] for
   emissions_multisig (700M), vault_source (120M), liquidity (100M), marketing (50M),
   airdrop (30M). Validates amounts sum to 1B, executes transfers with confirmation,
   writes a signed manifest of all txs.
3. 03-verify-distribution.ts — re-reads chain state and asserts every allocation sits where
   the manifest says; prints a markdown table for public posting.
4. 04-airdrop.ts — batch SPL transfers from a CSV (address,amount), 1000+ recipients,
   chunked, retry with backoff, resumable via a local sqlite/JSON checkpoint. (For the
   beta-tester + Heist-holder airdrop.)
5. 05-snapshot-holders.ts — given a Metaplex collection address (e.g., The Heist), snapshot
   current NFT holders via Helius DAS API into CSV for airdrop targeting.
6. README.md documenting the exact runbook order, with the Meteora steps marked MANUAL
   (vault config and DAMM seeding happen in Meteora's UI/SDK — link docs.meteora.ag and
   leave a checklist; do NOT attempt to script Meteora without me confirming current SDK).

CONSTRAINTS
- Never print or log private keys. Keypair only from file path or env.
- Every state-changing script: --dry-run default ON, requires --execute to send.
- Idempotency: scripts check current chain state before acting and refuse double-runs.
```

## Acceptance criteria
- Devnet full rehearsal completed end-to-end (mint → distribute → verify) with manifests
- Mainnet manifests published publicly post-TGE
- LP locked with public proof; multisig holds exactly 700M; circulating matches the tokenomics page
