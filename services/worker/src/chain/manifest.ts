/**
 * Art manifest loader — the contract with the art-studio agent. The manifest is
 * the source of the per-asset metadata URIs + stat bands the worker mints into.
 *
 * Both sides agree on this exact shape (do not redefine it without a matching
 * change in docs/specs + the art studio's writer). If the manifest is absent the
 * mint path falls back to a placeholder uri + the character's own stats, so
 * devnet works before art lands.
 *
 * Validation is hand-rolled (no zod): pnpm isolates zod from the worker package
 * and adding deps is out of scope. The checks below mirror the agreed schema.
 */
import { readFile } from "node:fs/promises";
import { makeRng } from "@trash-wars/economy";
import type { CharacterStats } from "@trash-wars/shared";

export type Band = [number, number];

export interface ManifestAsset {
  index: number;
  faction: "raccoon" | "bloodhound";
  rarity: "common" | "rare" | "epic" | "legendary";
  traits: Record<string, string>;
  statBands: { stealth: Band; muscle: Band; luck: Band; reputation: Band };
  metadataUri: string;
  imageUri: string;
}

export interface Manifest {
  collection: { name: string; address: string | null };
  assets: ManifestAsset[];
}

const FACTIONS = new Set(["raccoon", "bloodhound"]);
const RARITIES = new Set(["common", "rare", "epic", "legendary"]);

function isBand(v: unknown): v is Band {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
}

function validateAsset(a: unknown, i: number): ManifestAsset {
  const o = a as Record<string, unknown>;
  const fail = (msg: string): never => {
    throw new Error(`manifest asset[${i}] invalid: ${msg}`);
  };
  if (typeof o.index !== "number" || !Number.isInteger(o.index) || o.index < 0) fail("index");
  if (typeof o.faction !== "string" || !FACTIONS.has(o.faction)) fail("faction");
  if (typeof o.rarity !== "string" || !RARITIES.has(o.rarity)) fail("rarity");
  if (typeof o.metadataUri !== "string" || typeof o.imageUri !== "string") fail("uri");
  const sb = o.statBands as Record<string, unknown> | undefined;
  if (!sb || !isBand(sb.stealth) || !isBand(sb.muscle) || !isBand(sb.luck) || !isBand(sb.reputation)) {
    fail("statBands");
  }
  const traits = (o.traits && typeof o.traits === "object" ? o.traits : {}) as Record<string, string>;
  const bands = sb as { stealth: Band; muscle: Band; luck: Band; reputation: Band };
  return {
    index: o.index as number,
    faction: o.faction as "raccoon" | "bloodhound",
    rarity: o.rarity as ManifestAsset["rarity"],
    traits,
    statBands: {
      stealth: bands.stealth,
      muscle: bands.muscle,
      luck: bands.luck,
      reputation: bands.reputation,
    },
    metadataUri: o.metadataUri as string,
    imageUri: o.imageUri as string,
  };
}

export function validateManifest(data: unknown): Manifest {
  const o = data as Record<string, unknown>;
  const col = o.collection as Record<string, unknown> | undefined;
  if (!col || typeof col.name !== "string") {
    throw new Error("manifest.collection.name is required");
  }
  if (!Array.isArray(o.assets)) throw new Error("manifest.assets must be an array");
  return {
    collection: {
      name: col.name,
      address: typeof col.address === "string" ? col.address : null,
    },
    assets: o.assets.map(validateAsset),
  };
}

/** Read + validate the manifest at `path`. Throws on a malformed file. */
export async function loadManifest(path: string): Promise<Manifest> {
  const raw = await readFile(path, "utf8");
  return validateManifest(JSON.parse(raw));
}

/**
 * Pick the next unminted asset for a faction. `consumedIndices` is the set of
 * manifest indices already assigned. Returns the first faction-matching asset
 * whose index is not yet consumed, or undefined if exhausted for that faction.
 */
export function nextAsset(
  manifest: Manifest,
  faction: "raccoon" | "bloodhound",
  consumedIndices: ReadonlySet<number>,
): ManifestAsset | undefined {
  return manifest.assets
    .filter((a) => a.faction === faction)
    .sort((a, b) => a.index - b.index)
    .find((a) => !consumedIndices.has(a.index));
}

/**
 * Deterministically pick stats within the asset's bands, seeded by the order id
 * so a re-run of the same order produces identical stats (idempotent fulfillment).
 * Bands are inclusive [min, max]; non-integer bands are floored.
 */
export function statsFromBands(asset: ManifestAsset, seed: string): CharacterStats {
  const rng = makeRng(`manifest-stats:${seed}`);
  const pick = ([lo, hi]: Band): number => {
    const min = Math.floor(Math.min(lo, hi));
    const max = Math.floor(Math.max(lo, hi));
    if (max <= min) return min;
    return min + Math.floor(rng() * (max - min + 1));
  };
  return {
    stealth: pick(asset.statBands.stealth),
    muscle: pick(asset.statBands.muscle),
    luck: pick(asset.statBands.luck),
    reputation: pick(asset.statBands.reputation),
  };
}
