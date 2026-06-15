/**
 * Rarity engine. Drives weighted trait selection, the combined rarity tier, and
 * the per-rarity base-stat bands.
 *
 * INVARIANT (doc 07): rarity sets base-stat BANDS only — never mission odds. A
 * legendary raccoon just starts with a small base-stat edge + flex; all real
 * power still comes from $SHINY-burned upgrades.
 */
import type { CharacterStats } from "@trash-wars/shared";
import rarityData from "./rarity.json" with { type: "json" };
import { HOUND_TRAITS } from "./traits/bloodhound.js";
import { RACCOON_TRAITS } from "./traits/raccoon.js";
import type { Faction, TraitTable } from "./traits/types.js";

export type RarityTier = "common" | "rare" | "epic" | "legendary";

interface OptionMeta {
  weight: number;
  score: number;
}
type SlotMeta = Record<string, OptionMeta>;
type FactionMeta = Record<string, SlotMeta>;

const RARITY = rarityData as unknown as {
  raccoon: FactionMeta;
  bloodhound: FactionMeta;
};

export type Rng = () => number;

export function traitTable(faction: Faction): TraitTable {
  return faction === "bloodhound" ? HOUND_TRAITS : RACCOON_TRAITS;
}

function meta(faction: Faction): FactionMeta {
  return RARITY[faction];
}

/** Weighted pick from a slot. Falls back to uniform if a weight is missing. */
function pickWeighted(slot: string, options: string[], slotMeta: SlotMeta, rng: Rng): string {
  const weights = options.map((id) => slotMeta[id]?.weight ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return options[i]!;
  }
  return options[options.length - 1]!;
}

/** A concrete selection: slot id → option id. */
export type TraitSelection = Record<string, string>;

export function pickTraits(faction: Faction, rng: Rng): TraitSelection {
  const table = traitTable(faction);
  const fm = meta(faction);
  const selection: TraitSelection = {};
  for (const slot of Object.keys(table)) {
    const options = table[slot]!.map((o) => o.id);
    selection[slot] = pickWeighted(slot, options, fm[slot] ?? {}, rng);
  }
  return selection;
}

/**
 * Combined rarity. We sum the per-option rarity scores (excluding the always-on
 * silhouette slot's tiny score) and bucket the total. Tuned so the distribution
 * lands roughly: common ~55%, rare ~30%, epic ~12%, legendary ~3%.
 */
export function rarityScore(faction: Faction, selection: TraitSelection): number {
  const fm = meta(faction);
  let score = 0;
  for (const [slot, id] of Object.entries(selection)) {
    score += fm[slot]?.[id]?.score ?? 0;
  }
  return score;
}

/**
 * Tier thresholds. Raccoons have 7 scored slots, bloodhounds 8, so the summed
 * score is faction-relative — we normalize by slot count to a 0..1-ish density
 * before bucketing, which keeps the curve stable across factions. Tuned so the
 * distribution lands roughly common ~55% / rare ~30% / epic ~12% / legendary ~3%.
 */
export function rarityTier(faction: Faction, selection: TraitSelection): RarityTier {
  const slots = Object.keys(selection).length || 1;
  const density = rarityScore(faction, selection) / slots;
  // cutoffs are the 55/85/97th percentiles of the score distribution.
  if (density >= 0.464) return "legendary";
  if (density >= 0.371) return "epic";
  if (density >= 0.279) return "rare";
  return "common";
}

/** Per-rarity base-stat bands [min, max] (doc 07: common ~[1,2] … legendary ~[3,5]). */
export const STAT_BANDS: Record<RarityTier, [number, number]> = {
  common: [1, 2],
  rare: [2, 3],
  epic: [2, 4],
  legendary: [3, 5],
};

export type StatBands = {
  stealth: [number, number];
  muscle: [number, number];
  luck: [number, number];
  reputation: [number, number];
};

/**
 * Stat bands for the four stats. Raccoons get no reputation edge ([0,0]); the
 * Bloodhound reputation stat replaces luck-leaning edge. Bands are identical per
 * stat by default — the manifest stores them; the mint job rolls a concrete
 * value within the band at mint time.
 */
export function statBands(faction: Faction, tier: RarityTier): StatBands {
  const band = STAT_BANDS[tier];
  if (faction === "bloodhound") {
    return {
      stealth: [...band] as [number, number],
      muscle: [...band] as [number, number],
      luck: [Math.max(1, band[0] - 1), band[1] - 1] as [number, number],
      reputation: [...band] as [number, number],
    };
  }
  return {
    stealth: [...band] as [number, number],
    muscle: [...band] as [number, number],
    luck: [...band] as [number, number],
    reputation: [0, 0],
  };
}

/** Roll concrete base stats within the bands (deterministic from rng). */
export function rollStats(bands: StatBands, rng: Rng): CharacterStats {
  const r = (b: [number, number]): number => b[0] + Math.floor(rng() * (b[1] - b[0] + 1));
  return {
    stealth: r(bands.stealth),
    muscle: r(bands.muscle),
    luck: r(bands.luck),
    reputation: r(bands.reputation),
  };
}

/** Stable hash of a selection for dedupe (faction-scoped). */
export function traitHash(faction: Faction, selection: TraitSelection): string {
  const table = traitTable(faction);
  const parts = Object.keys(table).map((slot) => `${slot}=${selection[slot]}`);
  return `${faction}|${parts.join("&")}`;
}
