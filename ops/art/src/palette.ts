/**
 * Trash Wars noir palette + shared SVG primitives for the generative collection.
 *
 * Art direction (docs/10): noir city at night, deep navy/charcoal, neon amber
 * #FFB627 ($SHINY) accents, rain-on-glass, film grain, raccoon trench-coat
 * aesthetic. Every trait is drawn with 2-3 tone flat shading, dark outlines and
 * an amber rim-light from the right.
 */

export const PALETTE = {
  bg: "#0B0E14",
  surface: "#131822",
  surface2: "#1A2130",
  line: "#1F2735",
  text: "#E8ECF4",
  muted: "#8A94A6",
  accent: "#FFB627", // $SHINY amber
  accent2: "#FFD56B",
  danger: "#FF4D5E",
  success: "#3DDC97",
  pd: "#4D9DE0", // bloodhound / police blue
  jackpot: "#C792EA",
  ink: "#06080C",
} as const;

/** A fur/coat colour ramp: 4 tones from shadow → highlight, plus an outline. */
export interface Ramp {
  name: string;
  shadow: string;
  base: string;
  mid: string;
  light: string;
  outline: string;
}

/** Grey/brown raccoon fur ramps with the signature dark bandit mask. */
export const RACCOON_RAMPS: Ramp[] = [
  { name: "ash-grey", shadow: "#1E2532", base: "#7E8A99", mid: "#9AA6B5", light: "#D7DEE8", outline: "#10141C" },
  { name: "gutter-brown", shadow: "#241F19", base: "#766B5C", mid: "#8F8474", light: "#D9CFC0", outline: "#120F0A" },
  { name: "slate-blue", shadow: "#1A2230", base: "#67768A", mid: "#7F8FA4", light: "#C9D4E2", outline: "#0E141D" },
  { name: "smoke", shadow: "#23262C", base: "#6E747C", mid: "#888E96", light: "#CDD2DA", outline: "#0D0F13" },
  { name: "rust-grey", shadow: "#26211C", base: "#7A6E62", mid: "#94887A", light: "#E2D9C8", outline: "#130F0B" },
];

/** Tan/brown bloodhound coat ramps. */
export const HOUND_RAMPS: Ramp[] = [
  { name: "tan", shadow: "#3A2613", base: "#B98A56", mid: "#CDA06A", light: "#E8CCA0", outline: "#1E130A" },
  { name: "chestnut", shadow: "#2E1B0D", base: "#A4754A", mid: "#BC885A", light: "#DCB68C", outline: "#180D06" },
  { name: "honey", shadow: "#3F2A12", base: "#C09A6B", mid: "#D4AE7C", light: "#ECD3AC", outline: "#21160B" },
  { name: "liver", shadow: "#241208", base: "#8A5A38", mid: "#A06E46", light: "#C99A6C", outline: "#140A04" },
];

/** Accent tints used by neon/visor/jewel cosmetics. */
export const TINTS = ["#FFB627", "#4D9DE0", "#C792EA", "#3DDC97", "#FF4D5E"] as const;

/** Build a small linear gradient def string (top→bottom). */
export function linearGradient(id: string, from: string, to: string): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient>`;
}

export function radialGradient(id: string, inner: string, outer: string, cx = "50%", cy = "40%", r = "75%"): string {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0%" stop-color="${inner}"/><stop offset="100%" stop-color="${outer}"/></radialGradient>`;
}

/** Amber rim-light stroke from the right edge of a form — the signature look. */
export function rimLight(d: string, opacity = 0.55, color = PALETTE.accent, width = 4): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`;
}

/** Soft inner-shadow wash on a form (multiply-ish, faked with a dark fill). */
export function shadowWash(d: string, color: string, opacity = 0.28): string {
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}
