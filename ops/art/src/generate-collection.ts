/**
 * generate-collection.ts — the headline CLI.
 *
 *   pnpm gen:collection -- --count N --faction raccoon|bloodhound|mixed --seed S --out DIR
 *
 * Generates N unique (deduped by trait-hash) characters deterministically,
 * renders 2048px PNGs to <out>/images/, writes Metaplex Core metadata JSON per
 * asset to <out>/metadata/, and writes <out>/manifest.json (the worker contract).
 *
 * metadataUri/imageUri are local file:// paths until src/upload.ts rewrites them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeRng } from "@trash-wars/economy";
import { composeCharacter, tintFor } from "./compose.js";
import type { CoreMetadata, Manifest, ManifestAsset } from "./manifest.js";
import { pickTraits, rarityTier, rollStats, statBands, traitHash } from "./rarity.js";
import { renderPng } from "./render.js";
import type { Faction } from "./traits/types.js";

const SEASON = 1;

interface Args {
  count: number;
  faction: "raccoon" | "bloodhound" | "mixed";
  seed: string;
  out: string;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const faction = (get("--faction") ?? "mixed") as Args["faction"];
  if (!["raccoon", "bloodhound", "mixed"].includes(faction)) {
    throw new Error(`--faction must be raccoon|bloodhound|mixed (got ${faction})`);
  }
  return {
    count: Number(get("--count") ?? 60),
    faction,
    seed: get("--seed") ?? "42",
    out: get("--out") ?? "out/collection",
  };
}

function pickFaction(mode: Args["faction"], rng: () => number): Faction {
  if (mode === "mixed") {
    // ~12% bloodhounds to mirror the in-game scarcity cap (doc 07)
    return rng() < 0.12 ? "bloodhound" : "raccoon";
  }
  return mode;
}

function buildMetadata(asset: ManifestAsset): CoreMetadata {
  const attributes: CoreMetadata["attributes"] = [
    { trait_type: "Faction", value: asset.faction },
    { trait_type: "Rarity", value: asset.rarity },
    { trait_type: "Season", value: SEASON },
  ];
  for (const [slot, id] of Object.entries(asset.traits)) {
    attributes.push({ trait_type: titleCase(slot), value: id });
  }
  return {
    name: `Trash Wars #${asset.index}`,
    description:
      "A code-drawn denizen of Shorefront City. Raccoon crews knock over banks; Bloodhound PD eats what they confiscate. Burn $SHINY, run the odds, don't get rekt.",
    image: asset.imageUri,
    external_url: "https://trashwars.game",
    attributes,
    properties: { category: "image", files: [{ uri: asset.imageUri, type: "image/png" }] },
  };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function generateCollection(args: Args): Promise<Manifest> {
  const imagesDir = path.join(args.out, "images");
  const metaDir = path.join(args.out, "metadata");
  mkdirSync(imagesDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });

  const rng = makeRng(`collection:${args.seed}`);
  const seen = new Set<string>();

  // 1. select all unique trait combos deterministically (sequential RNG order).
  interface Plan {
    index: number;
    faction: Faction;
    selection: Record<string, string>;
    tier: ReturnType<typeof rarityTier>;
    bands: ReturnType<typeof statBands>;
    tint: string;
  }
  const plans: Plan[] = [];
  let attempts = 0;
  const maxAttempts = args.count * 60;
  while (plans.length < args.count && attempts < maxAttempts) {
    attempts++;
    const faction = pickFaction(args.faction, rng);
    const selection = pickTraits(faction, rng);
    const hash = traitHash(faction, selection);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const tier = rarityTier(faction, selection);
    const bands = statBands(faction, tier);
    rollStats(bands, rng); // advance RNG for base-stat determinism record
    const tint = tintFor(rng);
    plans.push({ index: plans.length, faction, selection, tier, bands, tint });
  }

  // 2. render in a small concurrency pool (sharp releases the event loop).
  const assets: ManifestAsset[] = new Array(plans.length);
  const CONCURRENCY = Number(process.env.ART_CONCURRENCY ?? 4);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < plans.length) {
      const p = plans[cursor++]!;
      const svg = composeCharacter(p.faction, p.selection, { tint: p.tint });
      const png = await renderPng(svg);
      const imageFile = path.join(imagesDir, `${p.index}.png`);
      writeFileSync(imageFile, png);
      const imageUri = pathToFileURL(path.resolve(imageFile)).href;
      const asset: ManifestAsset = {
        index: p.index,
        faction: p.faction,
        rarity: p.tier,
        traits: p.selection,
        statBands: p.bands,
        metadataUri: "",
        imageUri,
      };
      const metadata = buildMetadata(asset);
      const metaFile = path.join(metaDir, `${p.index}.json`);
      writeFileSync(metaFile, JSON.stringify(metadata, null, 2) + "\n");
      asset.metadataUri = pathToFileURL(path.resolve(metaFile)).href;
      assets[p.index] = asset;
      if ((p.index + 1) % 10 === 0) console.log(`  …rendered ${p.index + 1}/${plans.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plans.length) }, () => worker()));

  if (assets.length < args.count) {
    console.warn(
      `warning: only generated ${assets.length}/${args.count} unique characters (trait space exhausted for this faction after ${attempts} attempts)`,
    );
  }

  const manifest: Manifest = {
    collection: { name: "Trash Wars", address: null },
    assets,
  };
  const manifestPath = path.join(args.out, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const counts = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.rarity] = (acc[a.rarity] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`✓ ${assets.length} characters → ${args.out}`);
  console.log(`  images/  metadata/  manifest.json`);
  console.log(`  rarity: ${JSON.stringify(counts)}`);
  return manifest;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  generateCollection(args).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
