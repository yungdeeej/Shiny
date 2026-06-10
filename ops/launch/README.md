# $SHINY TGE launch runbook (`@trash-wars/launch-ops`)

TypeScript scripts (run with `tsx`) for the $SHINY token generation event, per
`docs/02-meteora-launch-playbook.md`. The Meteora steps are **MANUAL** — see the
checklist below; do **not** attempt to script them.

## Conventions (every script)

- `--rpc <url>` and `--keypair <path>` flags (or `RPC_URL` / `KEYPAIR_PATH` env).
  Keypairs are read from a `solana-keygen` JSON file. **Private keys are never
  printed or logged.**
- **Dry-run is the default.** State-changing scripts print their plan and exit;
  pass `--execute` to send transactions.
- Idempotent: scripts check current chain state and their own manifests before
  acting and refuse double-runs.
- Every run writes a JSON manifest to `ops/launch/out/` (gitignored) and prints
  Solana Explorer links. Mainnet manifests are published publicly post-TGE.

```sh
# from repo root
pnpm --filter @trash-wars/launch-ops <script> -- <flags>
```

## Runbook — exact order

**Rehearse the full sequence end-to-end on devnet first (acceptance criterion).**

### 1. Mint (T-30 → T-14)

```sh
pnpm --filter @trash-wars/launch-ops mint -- \
  --rpc $RPC --keypair $AUTHORITY \
  --metadata-uri https://<hosted-metadata-json> --execute
```

Creates the mint (6 decimals, freeze authority null), mints 1B to the authority
ATA, attaches immutable Metaplex metadata (name `Shiny`, symbol `SHINY`),
revokes the mint authority, and asserts the final chain state.
→ `out/01-mint-token.json`. **Publish the mint address and the
authority-revocation tx.**

### 2. Distribute

Copy `distribution.example.json` → `distribution.json` and fill in the real
addresses (Squads multisig vault for `emissions_multisig` — create the 3-of-5
multisig first and publish its address).

```sh
pnpm --filter @trash-wars/launch-ops distribute -- \
  --rpc $RPC --keypair $AUTHORITY --distribution ./distribution.json --execute
```

Validates the split sums to exactly 1B (700M emissions multisig / 120M vault
source / 100M liquidity / 50M marketing / 30M airdrop), transfers with
confirmation, and writes a **signed** manifest → `out/02-distribute.json`.

### 3. Verify (read-only)

```sh
pnpm --filter @trash-wars/launch-ops verify -- --rpc $RPC
```

Re-reads chain state, asserts every allocation sits where the manifest says,
and prints a markdown table for the public allocations post. Run this again
post-TGE and publish the output.

### 4. Meteora Alpha Vault + DAMM v2 — **MANUAL** (T-7 → T+26h)

Done in Meteora's UI/SDK, not scripted here. Meteora's products evolve
(Alpha Vault / DBC / DAMM v2 / DLMM) — **verify current docs the week you
configure**: <https://docs.meteora.ag>

- [ ] Alpha Vault configured: 120M $SHINY at fixed price (price = target raise / 120M),
      deposit cap with pro-rata overflow, **no whitelist, no vesting** —
      <https://docs.meteora.ag> → Alpha Vault
- [ ] Alpha Vault dry run completed on devnet
- [ ] T-0: vault opens (fund it from the `vault_source` wallet); T+24h closes, claims open
- [ ] T+24–26h: seed DAMM v2 pool — pair 60–80M $SHINY (liquidity allocation)
      with 60–70% of vault SOL proceeds; fee tier 1–2% (fees fund buyback) —
      <https://docs.meteora.ag> → DAMM v2
- [ ] LP position locked ≥ 12 months (Meteora lock or Streamflow); **publish the lock tx**
- [ ] Remaining SOL → ops + buyback reserve multisig; publish the raise breakdown on day 2

### 5. Airdrop (T+0 → T+3)

```sh
# snapshot The Heist holders (mainnet, Helius DAS)
HELIUS_API_KEY=... pnpm --filter @trash-wars/launch-ops snapshot -- \
  --collection <heistCollection> --per-nft <tokens-per-nft>

# merge with the beta-tester allocation CSV, then:
pnpm --filter @trash-wars/launch-ops airdrop -- \
  --rpc $RPC --keypair $AIRDROP_WALLET --mint <mint> --csv ./airdrop.csv --execute
```

Chunked, retried with backoff, resumable via `out/airdrop-checkpoint.json` —
safe to re-run after a crash.

### 6. Buyback & burn (post-TGE, discretionary, admin-triggered only)

```sh
pnpm --filter @trash-wars/launch-ops buyback -- \
  --rpc $RPC --keypair $BUYBACK_RESERVE --mint <mint> \
  --sol 25 --slippage-bps 50 --max-price-impact-pct 1.0 --execute
```

Jupiter v6 quote → swap (aborts if price impact exceeds the threshold) → burns
the actual received SHINY. Never automated; never run without a posted rationale.

## Devnet rehearsal checklist

- [ ] mint → distribute → verify all green, manifests in `out/`
- [ ] metadata visible on a devnet explorer, `isMutable: false`
      (the `createV1`-on-existing-mint path in `01-mint-token.ts` is the one
      API to double-check — see the comment in `attachMetadata`)
- [ ] airdrop of ≥ 1,000 rows completes; kill it mid-run and confirm resume
- [ ] buyback dry-run against Jupiter (mainnet quote, no send) prints sane numbers
