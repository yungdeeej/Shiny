# Devnet TGE rehearsal — ready to fire

Everything below is prepared and dry-run-validated against live devnet RPC
(2026-06-10). The only missing input is ~2 devnet SOL: the public RPC faucet
was rate-limited/dry from the build environment, and faucet.solana.com needs
a human + captcha.

## State

| Thing | Where |
|---|---|
| Mint/distribution authority | `GcB2q8gZwSvVcN8mwPL1WLSbxrxpdvxNDxm9Dkjt4i2T` (key: `.keys/devnet-authority.json`, gitignored) |
| Allocation wallets (5, throwaway) | `rehearsal-distribution.devnet.json` (keys in `.keys/`, gitignored) |
| Dry-run results | 01-mint ✓ · 02-distribute ✓ (sum-to-1B validated, ATAs derived, 5 transfers staged) |

## Fire (≈3 minutes)

```bash
# 0. Fund the authority with ~2 devnet SOL (any of):
#    - https://faucet.solana.com → paste GcB2q8gZwSvVcN8mwPL1WLSbxrxpdvxNDxm9Dkjt4i2T
#    - solana transfer GcB2q8... 2 --url devnet   (from any funded devnet wallet)

cd ops/launch
export RPC=https://api.devnet.solana.com
export KP=.keys/devnet-authority.json

# 1. Mint 1B $SHINY, attach metadata, revoke authorities
pnpm exec tsx src/01-mint-token.ts --rpc $RPC --keypair $KP \
  --metadata-uri https://example.com/shiny-devnet.json --execute
#    → out/01-mint-token.json contains the mint address

# 2. Distribute per docs/01 split (700/120/100/50/30M)
pnpm exec tsx src/02-distribute.ts --rpc $RPC --keypair $KP \
  --distribution rehearsal-distribution.devnet.json --execute

# 3. Verify on-chain state matches, get the public markdown table
pnpm exec tsx src/03-verify-distribution.ts --rpc $RPC \
  --distribution rehearsal-distribution.devnet.json
```

Then point the stack at the rehearsal token (see README "Devnet build"):

```bash
BETA_MODE=0 SOLANA_RPC_URL=$RPC SHINY_MINT=<mint from step 1> pnpm dev:api
NEXT_PUBLIC_DEMO_MODE=0 pnpm dev:web
```

## Watch-outs (flagged during the build)

- `01-mint-token.ts` metadata attach uses mpl-token-metadata v3 `createV1`
  against a pre-existing mint — isolated in `attachMetadata()`; if the umi arg
  shape moved, it's a one-function fix. The mint/distribute/revoke path uses
  only stable `@solana/spl-token` APIs.
- These are **throwaway rehearsal keys** living in a gitignored folder. The
  mainnet run uses fresh keys per docs/02, with the 700M going to the real
  Squads multisig, and the manifests in `out/` get published.
