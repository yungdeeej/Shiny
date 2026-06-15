/**
 * The mint manifest — the contract the worker's mint job reads. The shape here
 * is FROZEN; do not change field names without updating the worker.
 */
import type { Faction } from "./traits/types.js";
import type { RarityTier } from "./rarity.js";

export interface ManifestStatBands {
  stealth: [number, number];
  muscle: [number, number];
  luck: [number, number];
  reputation: [number, number];
}

export interface ManifestAsset {
  index: number;
  faction: Faction;
  rarity: RarityTier;
  traits: Record<string, string>;
  statBands: ManifestStatBands;
  metadataUri: string; // file:// until upload, then https/arweave
  imageUri: string;
}

export interface Manifest {
  collection: { name: string; address: string | null };
  assets: ManifestAsset[];
}

/** Metaplex Core-standard metadata (attributes incl. faction/rarity/season/traits). */
export interface CoreMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  attributes: { trait_type: string; value: string | number }[];
  properties: {
    category: "image";
    files: { uri: string; type: "image/png" }[];
  };
}
