# Trash Wars — Art & Content Studio (`ops/art`)

Deterministic, **100% code-drawn** generative NFT collection + marketing assets for
Trash Wars. No external art assets and no diffusion required — every pixel is an SVG
drawn from a seed, then rasterized with `sharp`. Designed to accept FLUX/diffusion
layers later (see _Diffusion hooks_ below).

```
src/
  palette.ts            noir palette + shared SVG primitives (ramps, rim-light, gradients)
  traits/
    types.ts            trait slot types + draw context
    raccoon.ts          raccoon trait drawers (background/fur/neckwear/expression/eyes/headwear/accessory)
    bloodhound.ts       bloodhound trait drawers (background/coat/collar/ears/jowls/expression/eyes/headwear)
  rarity.json           weighted rarity per trait option (weight + score)
  rarity.ts             pickTraits · rarityTier · statBands · rollStats · traitHash
  compose.ts            composeCharacter(faction, selection) → full 2048 SVG (vignette baked in)
  render.ts             SVG string → PNG buffer (grain composited on the raster side)
  manifest.ts           frozen manifest + Metaplex Core metadata types (the worker contract)
  generate-collection.ts  CLI: deterministic N-character collection → images/ metadata/ manifest.json
  upload.ts             Irys/Arweave upload (DRY-RUN default; UNVERIFIED umi calls behind IRYS_KEY)
  rarity-report.ts      prints trait distribution + rarity-tier counts of a manifest
  marketing.ts          typed code-drawn card library (hero/faction/sheet/wanted/burn/stats/vault)
  generate-marketing.ts CLI: renders the doc-12 campaign card set → out/marketing/
showcase/               2-3 small curated PNGs committed so the team sees the quality
out/                    gitignored — all generated images/metadata/marketing land here
```

## Commands

```bash
# Generate a collection (deterministic from --seed; deduped by trait-hash)
pnpm --filter @trash-wars/art-studio gen:collection -- --count 5000 --faction mixed --seed 42 --out out/collection

# Inspect the rarity curve of a generated manifest
pnpm --filter @trash-wars/art-studio exec tsx src/rarity-report.ts out/collection/manifest.json

# Render the marketing campaign card set
pnpm --filter @trash-wars/art-studio gen:marketing

# Upload images + metadata to Arweave (needs a funded key; dry-run otherwise)
IRYS_KEY=<base58> SOLANA_RPC_URL=<rpc> pnpm --filter @trash-wars/art-studio exec tsx src/upload.ts out/collection/manifest.json
```

`gen:collection` flags: `--count N` `--faction raccoon|bloodhound|mixed` `--seed S` `--out DIR`.
Render concurrency is tunable via `ART_CONCURRENCY` (default 4).

## Trait & rarity system

- **Raccoons** — 7 slots: background (4) · fur (5) · neckwear (4) · expression (4) ·
  eyes (4) · headwear (6) · accessory (5). The signature black bandit mask + ringed
  tail are always on; fur picks the colour ramp.
- **Bloodhounds** — 8 slots: background (3) · coat (4) · collar/rank (4) · ears (3) ·
  jowls (2) · expression (3) · eyes (2) · headwear (2). Precinct-blue collar with a
  rank badge (patrol → captain).
- **Rarity** — each option carries a `weight` (selection probability) and a `score`
  (0..1 rarity contribution) in `rarity.json`. `rarityTier` buckets the per-slot
  average score at the 55/85/97th percentiles. Tuned distribution: **common ~56% ·
  rare ~28% · epic ~12% · legendary ~3%**.
- **Stat bands (doc 07 — rarity sets BASE-STAT bands, never odds):**

  | rarity | band [min,max] |
  |--------|----------------|
  | common | [1, 2] |
  | rare | [2, 3] |
  | epic | [2, 4] |
  | legendary | [3, 5] |

  Raccoons get `reputation:[0,0]`; bloodhounds get a full `reputation` band and a
  reduced `luck` band. The manifest stores the **bands**; the worker's mint job rolls
  a concrete value within the band at mint time.

## Manifest schema (frozen — the worker's mint job reads this)

```jsonc
{
  "collection": { "name": "Trash Wars", "address": null },
  "assets": [
    {
      "index": 0,
      "faction": "raccoon",
      "rarity": "rare",
      "traits": { "background": "alley", "fur": "smoke", "...": "..." },
      "statBands": { "stealth": [2,3], "muscle": [2,3], "luck": [2,3], "reputation": [0,0] },
      "metadataUri": "file://…/metadata/0.json",  // → https/arweave after upload
      "imageUri": "file://…/images/0.png"          // → https/arweave after upload
    }
  ]
}
```

## Diffusion hooks (FLUX, later)

The collection is fully code-SVG today. To layer in diffusion later:

- `compose.ts` composes ordered SVG `<g>` layers — a FLUX-generated raster layer can
  be inserted into the painter's-order array (e.g. a generated background or a textured
  fur pass) without touching the trait selection / rarity logic.
- `render.ts` already composites raster layers (the grain) over the SVG raster — the
  same `sharp.composite` step accepts a diffusion PNG.
- `upload.ts` is upload-agnostic: whatever `imageUri` points at gets published.

**Honest status:** everything in `showcase/` and `out/` is deterministic code-SVG.
Diffusion (FLUX) is **not wired** — it's a documented insertion point, not a running
pipeline. The Sentinel's FAL/FLUX image path is likewise stubbed behind `FAL_KEY`.

## Keys / what's gated

- `IRYS_KEY` + `SOLANA_RPC_URL` — Irys/Arweave upload in `upload.ts`. **DRY-RUN by
  default**: with no key the manifest keeps local `file://` paths. The umi/irys calls
  are marked `// UNVERIFIED — needs a funded key`.
- No key is needed to generate the collection, metadata, manifest, or marketing.
