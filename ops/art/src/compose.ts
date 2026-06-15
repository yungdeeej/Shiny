/**
 * compose.ts — assemble a full character SVG from a trait selection.
 *
 * The trait drawers work in a 0..200 canvas; we scale that into a 2048×2048
 * artboard, then bake a noir vignette + film grain on top. The result is a
 * self-contained SVG string ready for sharp rasterization.
 */
import { HOUND_RAMPS, PALETTE, RACCOON_RAMPS, TINTS, linearGradient, radialGradient } from "./palette.js";
import type { Ramp } from "./palette.js";
import { HOUND_COAT_RAMP, HOUND_TRAITS } from "./traits/bloodhound.js";
import { RACCOON_FUR_RAMP, RACCOON_TRAITS } from "./traits/raccoon.js";
import type { DrawCtx, Faction, TraitTable } from "./traits/types.js";
import { traitTable } from "./rarity.js";
import type { Rng, TraitSelection } from "./rarity.js";

export const ART_SIZE = 2048;
const SCALE = ART_SIZE / 200;

function rampFor(faction: Faction, selection: TraitSelection): Ramp {
  if (faction === "bloodhound") {
    const name = HOUND_COAT_RAMP[selection.coat ?? "tan"] ?? "tan";
    return HOUND_RAMPS.find((r) => r.name === name) ?? HOUND_RAMPS[0]!;
  }
  const name = RACCOON_FUR_RAMP[selection.fur ?? "ash-grey"] ?? "ash-grey";
  return RACCOON_RAMPS.find((r) => r.name === name) ?? RACCOON_RAMPS[0]!;
}

function tintFor(rng: Rng): string {
  return TINTS[Math.floor(rng() * TINTS.length)] ?? PALETTE.accent;
}

function drawTrait(table: TraitTable, slot: string, id: string, ctx: DrawCtx): string {
  const option = table[slot]?.find((o) => o.id === id) ?? table[slot]?.[0];
  return option ? option.draw(ctx) : "";
}

/** Background defs used by the trait backgrounds. */
function backgroundDefs(): string {
  return [
    radialGradient("bg-alley", "#1B2333", "#080B12"),
    radialGradient("bg-neon", "#1A2438", "#070A11", "50%", "42%", "80%"),
    radialGradient("bg-rooftop", "#16203A", "#070A12"),
    radialGradient("bg-vault", "#241E12", "#0A0810"),
    radialGradient("bg-precinct", "#141E30", "#070B12"),
    radialGradient("bg-spotlight", "#1C2740", "#080C14"),
    radialGradient("bg-houndrain", "#16213A", "#080C14"),
    linearGradient("vignette", "rgba(0,0,0,0)", "rgba(0,0,0,0.55)"),
  ].join("");
}

/**
 * composeCharacter — full 2048 SVG for a faction + trait selection.
 * Deterministic: pass the same rng-derived tint via opts for reproducibility.
 */
export function composeCharacter(
  faction: Faction,
  selection: TraitSelection,
  opts: { tint?: string; rng?: Rng } = {},
): string {
  const table = traitTable(faction);
  const ramp = rampFor(faction, selection);
  const tint = opts.tint ?? (opts.rng ? tintFor(opts.rng) : PALETTE.accent);
  const ctx: DrawCtx = { ramp, tint, faction };

  // painter's order per faction
  const order =
    faction === "bloodhound"
      ? ["background", "ears", "coat", "jowls", "expression", "eyes", "collar", "headwear"]
      : ["background", "fur", "neckwear", "expression", "eyes", "headwear", "accessory"];

  const body = order.map((slot) => drawTrait(table, slot, selection[slot] ?? "", ctx)).join("\n");

  // NOTE: film grain is composited on the *raster* side (render.ts) from a small
  // tiled noise PNG. Full-canvas feTurbulence at 2048² costs ~14s/image in
  // librsvg, so it is deliberately NOT in this SVG. The vignette + rim glow stay
  // here (cheap gradients).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_SIZE}" height="${ART_SIZE}" viewBox="0 0 ${ART_SIZE} ${ART_SIZE}">
  <defs>
    ${backgroundDefs()}
    <radialGradient id="vig2" cx="50%" cy="44%" r="70%"><stop offset="62%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.6)"/></radialGradient>
  </defs>
  <rect width="${ART_SIZE}" height="${ART_SIZE}" fill="${PALETTE.bg}"/>
  <g transform="scale(${SCALE})">
    ${body}
  </g>
  <!-- amber rim glow from the right edge -->
  <ellipse cx="${ART_SIZE}" cy="${ART_SIZE * 0.46}" rx="${ART_SIZE * 0.22}" ry="${ART_SIZE * 0.55}" fill="${PALETTE.accent}" opacity="0.06"/>
  <!-- vignette -->
  <rect width="${ART_SIZE}" height="${ART_SIZE}" fill="url(#vignette)" opacity="0.9"/>
  <rect width="${ART_SIZE}" height="${ART_SIZE}" fill="url(#vig2)"/>
</svg>`;
}

export { tintFor };
