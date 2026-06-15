import type { Ramp } from "../palette.js";

/**
 * The drawing canvas is a 0..200 viewBox (the same coordinate space the live
 * web avatar uses) so the linework reads identically at 48px and 2048px.
 * compose.ts scales this to the final 2048 raster.
 */
export const CANVAS = 200;

/** A trait category. Order here is the painter's-algorithm draw order. */
export type RaccoonSlot =
  | "background"
  | "fur"
  | "neckwear"
  | "expression" // snout/mouth
  | "eyes"
  | "headwear"
  | "accessory";

export type HoundSlot =
  | "background"
  | "coat"
  | "collar"
  | "ears"
  | "jowls"
  | "expression"
  | "eyes"
  | "headwear";

export type Faction = "raccoon" | "bloodhound";

/** Context handed to every trait drawer. */
export interface DrawCtx {
  ramp: Ramp;
  /** accent tint chosen for this character (neon cosmetics) */
  tint: string;
  faction: Faction;
}

/** A trait option = id + label + a pure SVG-`<g>` producing function. */
export interface TraitOption {
  id: string;
  label: string;
  draw: (ctx: DrawCtx) => string;
}

/** A slot is an ordered list of options; rarity weights live in rarity.json. */
export type TraitTable = Record<string, TraitOption[]>;

export function g(inner: string, transform?: string): string {
  return transform ? `<g transform="${transform}">${inner}</g>` : `<g>${inner}</g>`;
}
