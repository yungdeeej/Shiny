/**
 * Bloodhound (Shorefront PD) trait drawers. The cop faction: tan/brown coats,
 * droopy ears, heavy jowls, a precinct-blue collar with a rank badge.
 *
 * Slots: background · coat · collar · ears · jowls · expression · eyes · headwear
 */
import { PALETTE, rimLight } from "../palette.js";
import type { DrawCtx, TraitOption, TraitTable } from "./types.js";
import { g } from "./types.js";

/* ── backgrounds ─────────────────────────────────────────────────────── */

function precinctBg(): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-precinct)"/>
     <rect x="20" y="40" width="160" height="160" fill="#0E1622"/>
     <g stroke="#1F2735" stroke-width="2" opacity="0.6">
       <line x1="20" y1="80" x2="180" y2="80"/><line x1="20" y1="120" x2="180" y2="120"/>
       <line x1="70" y1="40" x2="70" y2="200"/><line x1="130" y1="40" x2="130" y2="200"/>
     </g>
     <rect x="86" y="30" width="28" height="14" rx="3" fill="#4D9DE0" opacity="0.5"/>
     <rect x="60" y="150" width="6" height="50" fill="#4D9DE0" opacity="0.3"/>`,
  );
}

function spotlightBg(): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-spotlight)"/>
     <path d="M 100 -10 L 36 200 L 164 200 Z" fill="#FFFFFF" opacity="0.07"/>
     <path d="M 100 -10 L 60 200 L 140 200 Z" fill="#4D9DE0" opacity="0.06"/>
     <circle cx="100" cy="6" r="10" fill="#E8ECF4" opacity="0.6"/>`,
  );
}

function houndRainBg(): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-houndrain)"/>
     <g opacity="0.45">
       <rect x="44" y="24" width="3" height="44" fill="#4D9DE0" opacity="0.5"/>
       <rect x="150" y="18" width="3" height="50" fill="#FFB627" opacity="0.4"/>
     </g>
     ${rainStreaks(0.5)}`,
  );
}

/* ── coat (silhouette + muzzle) ──────────────────────────────────────── */

function houndBody(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<path d="M 40 200 C 40 162 62 146 100 146 C 138 146 160 162 160 200 Z" fill="${p.base}" stroke="${p.outline}" stroke-width="3.5"/>
     <path d="M 100 146 C 138 146 160 162 160 200 L 138 200 C 138 170 122 154 100 150 Z" fill="${p.shadow}" opacity="0.5"/>
     <path d="M 40 200 C 40 170 54 154 74 150 L 68 200 Z" fill="${p.mid}" opacity="0.4"/>
     <path d="M 100 44 C 130 44 148 62 148 88 C 148 106 142 116 134 122 C 130 136 118 146 100 146 C 82 146 70 136 66 122 C 58 116 52 106 52 88 C 52 62 70 44 100 44 Z" fill="${p.base}" stroke="${p.outline}" stroke-width="3.5"/>
     <path d="M 100 44 C 130 44 148 62 148 88 C 148 104 143 114 135 120 C 142 110 144 96 142 86 C 138 64 122 50 100 50 Z" fill="${p.mid}" opacity="0.55"/>
     <path d="M 100 44 C 82 44 68 54 60 70 C 68 56 82 50 100 50 Z" fill="${p.light}" opacity="0.4"/>
     <path d="M 78 60 Q 100 52 122 60" fill="none" stroke="${p.shadow}" stroke-width="2.2" stroke-linecap="round" opacity="0.8"/>
     <path d="M 82 68 Q 100 61 118 68" fill="none" stroke="${p.shadow}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
     <path d="M 84 102 C 90 96 110 96 116 102 C 122 112 116 130 100 130 C 84 130 78 112 84 102 Z" fill="${p.light}"/>
     <path d="M 84 102 C 90 96 110 96 116 102 C 118 106 118 111 116 116 C 110 111 90 111 84 116 C 82 111 82 106 84 102 Z" fill="#fff" opacity="0.2"/>
     <path d="M 90 100 C 94 96 106 96 110 100 C 112 107 107 111 100 111 C 93 111 88 107 90 100 Z" fill="${p.outline}"/>
     <circle cx="96" cy="100" r="1.8" fill="#fff" opacity="0.5"/>
     ${rimLight("M 144 68 C 150 82 150 102 144 116", 0.5)}`,
  );
}

/* ── ears (droopy variants, drawn behind via low z but here as overlay) ── */

function earsLong(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<path d="M 52 74 C 34 82 30 122 38 152 C 48 162 62 158 66 144 C 68 118 62 88 60 78 Z" fill="${p.shadow}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M 148 74 C 166 82 170 122 162 152 C 152 162 138 158 134 144 C 132 118 138 88 140 78 Z" fill="${p.shadow}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M 50 90 C 44 108 44 130 50 144" fill="none" stroke="${p.outline}" stroke-width="1.5" opacity="0.4"/>`,
  );
}
function earsShort(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<path d="M 54 72 C 40 78 36 104 44 124 C 52 130 62 126 64 116 C 66 98 60 80 58 74 Z" fill="${p.shadow}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M 146 72 C 160 78 164 104 156 124 C 148 130 138 126 136 116 C 134 98 140 80 142 74 Z" fill="${p.shadow}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>`,
  );
}
function earsTorn(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<path d="M 52 74 C 34 82 30 122 38 152 C 48 162 62 158 66 144 C 68 118 62 88 60 78 Z" fill="${p.shadow}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M 148 74 C 166 82 170 118 164 140 L 156 128 L 160 144 L 150 134 C 138 138 134 120 134 110 C 132 96 138 80 140 78 Z" fill="${p.shadow}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>`,
  );
}

/* ── jowls ───────────────────────────────────────────────────────────── */

function jowlsHeavy(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<path d="M 72 110 C 62 114 58 134 68 144 C 78 152 90 148 92 136 C 92 122 84 110 72 110 Z" fill="${p.light}" stroke="${p.outline}" stroke-width="2.5"/>
     <path d="M 128 110 C 138 114 142 134 132 144 C 122 152 110 148 108 136 C 108 122 116 110 128 110 Z" fill="${p.light}" stroke="${p.outline}" stroke-width="2.5"/>
     <path d="M 70 120 C 66 128 66 138 72 142" fill="none" stroke="${p.shadow}" stroke-width="1.6" opacity="0.5"/>
     <path d="M 130 120 C 134 128 134 138 128 142" fill="none" stroke="${p.shadow}" stroke-width="1.6" opacity="0.5"/>`,
  );
}
function jowlsTrim(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<path d="M 74 112 C 66 116 64 130 72 138 C 80 144 88 140 90 130 C 90 118 84 112 74 112 Z" fill="${p.light}" stroke="${p.outline}" stroke-width="2.4"/>
     <path d="M 126 112 C 134 116 136 130 128 138 C 120 144 112 140 110 130 C 110 118 116 112 126 112 Z" fill="${p.light}" stroke="${p.outline}" stroke-width="2.4"/>`,
  );
}

/* ── eyes (tired hound eyes) ─────────────────────────────────────────── */

const EYE_Y = 91;
const LX = 78;
const RX = 122;

function houndEyesDroopy(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    [LX, RX]
      .map(
        (x) =>
          `<circle cx="${x}" cy="${EYE_Y}" r="8.5" fill="#F4E9D8"/>
           <circle cx="${x + 1}" cy="${EYE_Y + 1.5}" r="4.2" fill="${p.outline}"/>
           <circle cx="${x + 2.6}" cy="${EYE_Y}" r="1.4" fill="#fff" opacity="0.85"/>
           <path d="M ${x - 9} ${EYE_Y - 3} A 9 9 0 0 1 ${x + 9} ${EYE_Y - 3} L ${x + 9} ${EYE_Y - 10} L ${x - 9} ${EYE_Y - 10} Z" fill="${p.shadow}"/>
           <path d="M ${x - 9} ${EYE_Y + 4} Q ${x} ${EYE_Y + 9} ${x + 9} ${EYE_Y + 4}" fill="none" stroke="${p.shadow}" stroke-width="1.8" opacity="0.6"/>`,
      )
      .join(""),
  );
}
function houndEyesSharp(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    [LX, RX]
      .map(
        (x) =>
          `<circle cx="${x}" cy="${EYE_Y}" r="9" fill="#F4E9D8"/>
           <circle cx="${x + 1}" cy="${EYE_Y + 1}" r="4.6" fill="${p.outline}"/>
           <circle cx="${x + 3}" cy="${EYE_Y - 1}" r="1.8" fill="#fff"/>
           <line x1="${x - 11} " y1="${EYE_Y - 9}" x2="${x + 4}" y2="${EYE_Y - 6}" stroke="${p.shadow}" stroke-width="2.2" stroke-linecap="round"/>`,
      )
      .join(""),
  );
}

/* ── expression ──────────────────────────────────────────────────────── */

function houndStern(ctx: DrawCtx): string {
  return `<path d="M 88 126 Q 100 122 112 126" fill="none" stroke="${ctx.ramp.outline}" stroke-width="2.5" stroke-linecap="round"/>`;
}
function houndSnarl(ctx: DrawCtx): string {
  const o = ctx.ramp.outline;
  return g(
    `<path d="M 86 124 Q 100 130 114 124" fill="none" stroke="${o}" stroke-width="2.6" stroke-linecap="round"/>
     <path d="M 90 124 L 88 119 L 94 123 Z" fill="#EFF3F8" stroke="${o}" stroke-width="1"/>
     <path d="M 110 124 L 112 119 L 106 123 Z" fill="#EFF3F8" stroke="${o}" stroke-width="1"/>`,
  );
}
function houndPant(ctx: DrawCtx): string {
  const o = ctx.ramp.outline;
  return g(
    `<path d="M 88 124 Q 100 134 112 124 Z" fill="#3A1818" stroke="${o}" stroke-width="2.4"/>
     <ellipse cx="100" cy="130" rx="5" ry="4" fill="#FF8A8A" opacity="0.8"/>`,
  );
}

/* ── collar + rank badge ─────────────────────────────────────────────── */

function collarRank(rank: number, color: string) {
  return (ctx: DrawCtx): string => {
    const o = ctx.ramp.outline;
    const stars = Array.from({ length: rank })
      .map((_, i) => {
        const sx = 100 + (i - (rank - 1) / 2) * 13;
        return `<g transform="translate(${sx} 172)"><path d="M 0 -4.5 L 1.4 -1.5 L 4.6 -1.3 L 2.2 0.8 L 3 4 L 0 2.2 L -3 4 L -2.2 0.8 L -4.6 -1.3 L -1.4 -1.5 Z" fill="${o}"/></g>`;
      })
      .join("");
    return g(
      `<path d="M 60 156 C 86 148 114 148 140 156 L 138 170 C 112 162 88 162 62 170 Z" fill="#22324A" stroke="${o}" stroke-width="2.5"/>
       <path d="M 60 156 C 86 148 114 148 140 156 L 139 160 C 113 152 87 152 61 160 Z" fill="#4D9DE0" opacity="0.5"/>
       <g transform="translate(100 170)">
         <circle r="11" fill="${color}" stroke="${o}" stroke-width="2"/>
         <circle r="11" fill="none" stroke="#fff" stroke-width="1" opacity="0.4"/>
       </g>
       ${stars}`,
    );
  };
}

/* ── headwear ────────────────────────────────────────────────────────── */

function houndNoHat(): string {
  return "";
}
function policeCap(ctx: DrawCtx): string {
  const o = ctx.ramp.outline;
  return g(
    `<path d="M 54 60 C 54 42 146 42 146 60 C 116 52 84 52 54 60 Z" fill="#1A2740" stroke="${o}" stroke-width="3"/>
     <path d="M 50 60 C 84 54 116 54 150 60 L 150 68 C 116 60 84 60 50 68 Z" fill="#101A2C" stroke="${o}" stroke-width="2.5"/>
     <rect x="86" y="46" width="28" height="11" rx="2" fill="#06080C" stroke="${o}" stroke-width="1.5"/>
     <circle cx="100" cy="51.5" r="3.2" fill="${ctx.tint}" stroke="${o}" stroke-width="1"/>
     <path d="M 38 62 C 54 58 92 58 100 62 C 70 64 52 66 40 70 C 36 66 36 63 38 62 Z" fill="#0C1424" stroke="${o}" stroke-width="2.5"/>`,
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function rainStreaks(opacity: number): string {
  const lines: string[] = [];
  for (let i = 0; i < 16; i++) {
    const x = (i * 15 + (i % 2) * 6) % 200;
    const y = (i * 27) % 180;
    lines.push(`<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 13}" stroke="#9AC4E8" stroke-width="1" opacity="${opacity * 0.5}"/>`);
  }
  return `<g>${lines.join("")}</g>`;
}

const opt = (id: string, label: string, draw: (c: DrawCtx) => string): TraitOption => ({ id, label, draw });

export const HOUND_TRAITS: TraitTable = {
  background: [
    opt("precinct", "Precinct", precinctBg),
    opt("spotlight", "Spotlight", spotlightBg),
    opt("rain", "Rain", houndRainBg),
  ],
  coat: [
    opt("tan", "Tan", houndBody),
    opt("chestnut", "Chestnut", houndBody),
    opt("honey", "Honey", houndBody),
    opt("liver", "Liver", houndBody),
  ],
  collar: [
    opt("patrol", "Patrol Badge", collarRank(1, "#C0C7D0")),
    opt("sergeant", "Sergeant", collarRank(2, "#FFB627")),
    opt("lieutenant", "Lieutenant", collarRank(3, "#FFD56B")),
    opt("captain", "Captain", collarRank(3, PALETTE.jackpot)),
  ],
  ears: [
    opt("long", "Long Droop", earsLong),
    opt("short", "Short", earsShort),
    opt("torn", "Torn", earsTorn),
  ],
  jowls: [
    opt("heavy", "Heavy", jowlsHeavy),
    opt("trim", "Trim", jowlsTrim),
  ],
  expression: [
    opt("stern", "Stern", houndStern),
    opt("snarl", "Snarl", houndSnarl),
    opt("pant", "Pant", houndPant),
  ],
  eyes: [
    opt("droopy", "Droopy", houndEyesDroopy),
    opt("sharp", "Sharp", houndEyesSharp),
  ],
  headwear: [
    opt("none", "None", houndNoHat),
    opt("police-cap", "Police Cap", policeCap),
  ],
};

export const HOUND_COAT_RAMP: Record<string, string> = {
  tan: "tan",
  chestnut: "chestnut",
  honey: "honey",
  liver: "liver",
};
