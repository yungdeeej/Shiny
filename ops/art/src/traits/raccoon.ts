/**
 * Raccoon trait drawers. Each function returns an SVG `<g>` string in the 0..200
 * canvas. Refined over the live web avatar: 4-tone fur ramps (shadow/base/mid/
 * light), confident dark outlines, amber rim-light from the right.
 *
 * Slots: background · fur · neckwear · expression · eyes · headwear · accessory
 */
import { PALETTE, rimLight } from "../palette.js";
import type { DrawCtx, TraitOption, TraitTable } from "./types.js";
import { g } from "./types.js";

/* ── backgrounds ─────────────────────────────────────────────────────── */

function alleyBg(): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-alley)"/>
     <rect x="14" y="20" width="40" height="180" fill="#0E141F"/>
     <rect x="150" y="8" width="44" height="192" fill="#0C111B"/>
     <rect x="58" y="40" width="84" height="160" fill="#101623"/>
     <g opacity="0.5">${dots("#FFD56B", [[24, 60], [34, 96], [168, 50], [176, 120], [70, 70], [120, 58]])}</g>
     <rect x="60" y="150" width="6" height="50" fill="#3DDC97" opacity="0.35"/>
     <rect x="134" y="120" width="5" height="80" fill="#FF4D5E" opacity="0.3"/>`,
  );
}

function neonRainBg(ctx: DrawCtx): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-neon)"/>
     <g opacity="0.6">
       <rect x="40" y="30" width="3" height="40" fill="${ctx.tint}" opacity="0.5"/>
       <rect x="150" y="20" width="3" height="56" fill="#FF4D5E" opacity="0.45"/>
       <rect x="96" y="14" width="3" height="34" fill="#3DDC97" opacity="0.4"/>
     </g>
     ${rainStreaks(0.5)}`,
  );
}

function rooftopBg(): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-rooftop)"/>
     <circle cx="44" cy="42" r="22" fill="#E8ECF4" opacity="0.85"/>
     <circle cx="52" cy="36" r="20" fill="#0d1322" opacity="0.6"/>
     <g fill="#0C111B">
       <rect x="0" y="150" width="40" height="50"/><rect x="46" y="132" width="30" height="68"/>
       <rect x="150" y="140" width="50" height="60"/><rect x="128" y="120" width="22" height="80"/>
     </g>
     <g opacity="0.4">${dots("#FFD56B", [[10, 165], [56, 150], [160, 158], [134, 140]])}</g>`,
  );
}

function vaultGlowBg(): string {
  return g(
    `<rect width="200" height="200" fill="url(#bg-vault)"/>
     <ellipse cx="100" cy="110" rx="96" ry="100" fill="#FFB627" opacity="0.08"/>
     <circle cx="100" cy="104" r="74" fill="none" stroke="#3A3220" stroke-width="10" opacity="0.6"/>
     <circle cx="100" cy="104" r="56" fill="none" stroke="#2A2415" stroke-width="6" opacity="0.7"/>
     <g stroke="#FFB627" stroke-width="2" opacity="0.3">
       <line x1="100" y1="34" x2="100" y2="18"/><line x1="100" y1="190" x2="100" y2="174"/>
       <line x1="30" y1="104" x2="14" y2="104"/><line x1="186" y1="104" x2="170" y2="104"/>
     </g>`,
  );
}

/* ── fur (the body/head silhouette + bandit mask + ringed tail) ───────── */

function raccoonBody(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<g transform="translate(150 132) rotate(-32)">
       <rect x="-11" y="0" width="24" height="58" rx="12" fill="${p.base}" stroke="${p.outline}" stroke-width="3"/>
       <rect x="-11" y="9" width="24" height="10" fill="${p.shadow}"/>
       <rect x="-11" y="27" width="24" height="10" fill="${p.shadow}"/>
       <rect x="-11" y="45" width="24" height="9" rx="4" fill="${p.shadow}"/>
       <rect x="-11" y="0" width="6" height="58" rx="3" fill="${p.mid}" opacity="0.5"/>
     </g>
     <path d="M 42 200 C 42 160 64 144 100 144 C 136 144 158 160 158 200 Z" fill="${p.base}" stroke="${p.outline}" stroke-width="3.5"/>
     <path d="M 100 144 C 136 144 158 160 158 200 L 136 200 C 136 168 120 152 100 148 Z" fill="${p.shadow}" opacity="0.5"/>
     <path d="M 42 200 C 42 168 56 152 76 148 L 70 200 Z" fill="${p.mid}" opacity="0.4"/>
     <path d="M 92 150 L 100 164 L 108 150" fill="none" stroke="${p.shadow}" stroke-width="2.6" stroke-linecap="round"/>
     <g>
       <path d="M 50 56 C 48 34 60 26 76 32 C 72 44 68 54 66 62 Z" fill="${p.base}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>
       <path d="M 57 48 C 57 40 64 36 70 38 C 68 44 66 50 65 54 Z" fill="${p.shadow}"/>
       <path d="M 150 56 C 152 34 140 26 124 32 C 128 44 132 54 134 62 Z" fill="${p.base}" stroke="${p.outline}" stroke-width="3.5" stroke-linejoin="round"/>
       <path d="M 143 48 C 143 40 136 36 130 38 C 132 44 134 50 135 54 Z" fill="${p.shadow}"/>
     </g>
     <path d="M 100 42 C 135 42 153 65 153 94 C 153 125 132 143 100 143 C 68 143 47 125 47 94 C 47 65 65 42 100 42 Z" fill="${p.base}" stroke="${p.outline}" stroke-width="3.5"/>
     <path d="M 100 42 C 135 42 153 65 153 94 C 153 116 144 132 128 139 C 140 130 146 114 146 96 C 146 70 128 50 100 49 Z" fill="${p.mid}" opacity="0.55"/>
     <path d="M 100 42 C 80 42 64 52 56 68 C 64 56 80 50 100 50 Z" fill="${p.light}" opacity="0.4"/>
     <path d="M 47 100 L 36 96 L 47 108 L 38 108 L 49 116" fill="none" stroke="${p.outline}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M 153 100 L 164 96 L 153 108 L 162 108 L 151 116" fill="none" stroke="${p.outline}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M 60 76 C 64 62 80 58 92 64 C 90 72 86 78 80 82 C 72 82 64 80 60 76 Z" fill="${p.light}"/>
     <path d="M 140 76 C 136 62 120 58 108 64 C 110 72 114 78 120 82 C 128 82 136 80 140 76 Z" fill="${p.light}"/>
     <path d="M 51 85 C 65 77 84 79 100 83 C 116 79 135 77 149 85 C 151 95 145 103 135 105 C 123 107 111 101 100 97 C 89 101 77 107 65 105 C 55 103 49 95 51 85 Z" fill="${p.outline}"/>
     <path d="M 78 107 C 86 101 114 101 122 107 C 128 117 120 133 100 133 C 80 133 72 117 78 107 Z" fill="${p.light}"/>
     <path d="M 78 107 C 86 101 114 101 122 107 C 124 111 124 116 122 121 C 114 116 86 116 78 121 C 76 116 76 111 78 107 Z" fill="#fff" opacity="0.25"/>
     <path d="M 91 107 C 95 103 105 103 109 107 C 109 113 105 116 100 116 C 95 116 91 113 91 107 Z" fill="${p.outline}"/>
     <circle cx="96" cy="107.5" r="1.6" fill="#fff" opacity="0.6"/>
     <g fill="${p.shadow}" opacity="0.85"><circle cx="82" cy="117" r="1.2"/><circle cx="78" cy="121" r="1.2"/><circle cx="118" cy="117" r="1.2"/><circle cx="122" cy="121" r="1.2"/></g>
     ${rimLight("M 149 66 C 156 80 156 108 147 124", 0.5)}
     ${rimLight("M 151 166 C 156 176 158 188 158 198", 0.35, PALETTE.accent, 3)}`,
  );
}

/* ── eyes ────────────────────────────────────────────────────────────── */

const EYE_Y = 89;
const LX = 76;
const RX = 124;

function eyesSly(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    [LX, RX]
      .map(
        (x) =>
          `<circle cx="${x}" cy="${EYE_Y}" r="9" fill="#EFF3F8"/>
           <circle cx="${x + 1.5}" cy="${EYE_Y + 1.5}" r="4.4" fill="${p.outline}"/>
           <circle cx="${x + 3}" cy="${EYE_Y}" r="1.5" fill="#fff" opacity="0.9"/>
           <path d="M ${x - 10} ${EYE_Y - 4} A 10 10 0 0 1 ${x + 10} ${EYE_Y - 4} L ${x + 10} ${EYE_Y - 11} L ${x - 10} ${EYE_Y - 11} Z" fill="${p.shadow}"/>
           <line x1="${x - 9}" y1="${EYE_Y - 4.5}" x2="${x + 9}" y2="${EYE_Y - 4.5}" stroke="${p.outline}" stroke-width="1.6" stroke-linecap="round"/>`,
      )
      .join(""),
  );
}

function eyesWide(): string {
  return g(
    [LX, RX]
      .map(
        (x) =>
          `<circle cx="${x}" cy="${EYE_Y}" r="10" fill="#EFF3F8"/>
           <circle cx="${x + 1}" cy="${EYE_Y + 1}" r="5.6" fill="#101820"/>
           <circle cx="${x + 3.4}" cy="${EYE_Y - 1.6}" r="2" fill="#fff"/>`,
      )
      .join(""),
  );
}

function eyesScarred(ctx: DrawCtx): string {
  const p = ctx.ramp;
  return g(
    `<circle cx="${LX}" cy="${EYE_Y}" r="9" fill="#EFF3F8"/>
     <circle cx="${LX + 1.5}" cy="${EYE_Y + 1.5}" r="4.4" fill="${p.outline}"/>
     <path d="M ${LX - 10} ${EYE_Y - 4} A 10 10 0 0 1 ${LX + 10} ${EYE_Y - 4} L ${LX + 10} ${EYE_Y - 11} L ${LX - 10} ${EYE_Y - 11} Z" fill="${p.shadow}"/>
     <circle cx="${RX}" cy="${EYE_Y}" r="8" fill="#EFF3F8"/>
     <circle cx="${RX + 1}" cy="${EYE_Y + 1}" r="4" fill="${p.outline}"/>
     <line x1="${RX - 4}" y1="${EYE_Y - 14}" x2="${RX + 5}" y2="${EYE_Y + 12}" stroke="${p.light}" stroke-width="2.4" stroke-linecap="round" opacity="0.85"/>
     <line x1="${RX - 7}" y1="${EYE_Y - 7}" x2="${RX - 1}" y2="${EYE_Y - 9}" stroke="${p.light}" stroke-width="1.8" stroke-linecap="round" opacity="0.7"/>`,
  );
}

function eyesVisorGlint(ctx: DrawCtx): string {
  // glowing tint slit — legendary-leaning cyber look
  return g(
    `<rect x="58" y="${EYE_Y - 8}" width="84" height="15" rx="7.5" fill="#06080C" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
     <rect x="62" y="${EYE_Y - 5}" width="76" height="6" rx="3" fill="${ctx.tint}" opacity="0.9"/>
     <rect x="66" y="${EYE_Y - 4}" width="20" height="3" rx="1.5" fill="#fff" opacity="0.7"/>
     <circle cx="${LX}" cy="${EYE_Y - 1.5}" r="2.4" fill="#fff" opacity="0.9"/>
     <circle cx="${RX}" cy="${EYE_Y - 1.5}" r="2.4" fill="#fff" opacity="0.9"/>`,
  );
}

/* ── expression (mouth / snout) ──────────────────────────────────────── */

function exprSmirk(ctx: DrawCtx): string {
  return `<path d="M 90 124 Q 100 131 112 121" fill="none" stroke="${ctx.ramp.outline}" stroke-width="2.4" stroke-linecap="round"/>`;
}
function exprGrit(ctx: DrawCtx): string {
  const o = ctx.ramp.outline;
  return g(
    `<path d="M 88 122 Q 100 128 112 122" fill="none" stroke="${o}" stroke-width="2.6" stroke-linecap="round"/>
     <rect x="91" y="122" width="18" height="5" fill="#EFF3F8" opacity="0.85"/>
     <line x1="95" y1="122" x2="95" y2="127" stroke="${o}" stroke-width="1.3"/>
     <line x1="101" y1="122" x2="101" y2="127.5" stroke="${o}" stroke-width="1.3"/>
     <line x1="107" y1="122" x2="107" y2="126.5" stroke="${o}" stroke-width="1.3"/>`,
  );
}
function exprDeadpan(ctx: DrawCtx): string {
  return `<line x1="92" y1="125" x2="110" y2="125" stroke="${ctx.ramp.outline}" stroke-width="2.4" stroke-linecap="round"/>`;
}
function exprGrin(ctx: DrawCtx): string {
  const o = ctx.ramp.outline;
  return g(
    `<path d="M 86 121 Q 100 136 114 121 Z" fill="#EFF3F8" stroke="${o}" stroke-width="2.4" stroke-linejoin="round"/>
     <path d="M 86 121 Q 100 124 114 121" fill="none" stroke="${o}" stroke-width="1.6"/>
     <path d="M 100 130 L 96 136 L 104 136 Z" fill="#FF8A8A" opacity="0.7"/>`,
  );
}

/* ── headwear ────────────────────────────────────────────────────────── */

function noHat(): string {
  return "";
}
function fedora(ctx: DrawCtx): string {
  return g(
    `<path d="M 36 66 C 70 58 130 58 164 66 C 166 73 159 78 148 78 C 116 70 84 70 52 78 C 41 78 34 73 36 66 Z" fill="#26221B" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 60 64 C 58 44 74 32 100 32 C 126 32 142 44 140 64 C 114 58 86 58 60 64 Z" fill="#33301F" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 60 60 C 88 53 112 53 140 60 L 140 67 C 112 60 88 60 60 67 Z" fill="${ctx.tint}" opacity="0.9"/>
     <path d="M 132 36 C 138 44 140 54 138 62" fill="none" stroke="#FFB627" stroke-width="2.2" opacity="0.5"/>`,
  );
}
function beanie(ctx: DrawCtx): string {
  return g(
    `<path d="M 54 64 C 54 38 146 38 146 64 L 146 70 C 116 60 84 60 54 70 Z" fill="${ctx.tint}" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 52 64 C 84 54 116 54 148 64 L 148 75 C 116 65 84 65 52 75 Z" fill="#1A2130" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
     <path d="M 70 44 C 80 40 120 40 130 44" fill="none" stroke="#06080C" stroke-width="2" opacity="0.4"/>`,
  );
}
function crown(ctx: DrawCtx): string {
  return g(
    `<path d="M 64 60 L 68 32 L 84 49 L 100 26 L 116 49 L 132 32 L 136 60 C 112 52 88 52 64 60 Z" fill="#FFB627" stroke="${ctx.ramp.outline}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M 64 60 C 88 52 112 52 136 60 L 136 56 C 112 49 88 49 64 56 Z" fill="#B8801A"/>
     <circle cx="68" cy="32" r="3.6" fill="#FFD56B" stroke="${ctx.ramp.outline}" stroke-width="2"/>
     <circle cx="100" cy="26" r="3.8" fill="#C792EA" stroke="${ctx.ramp.outline}" stroke-width="2"/>
     <circle cx="132" cy="32" r="3.6" fill="#FFD56B" stroke="${ctx.ramp.outline}" stroke-width="2"/>`,
  );
}
function cap(ctx: DrawCtx): string {
  return g(
    `<path d="M 56 62 C 56 40 144 40 144 62 C 116 54 84 54 56 62 Z" fill="${ctx.tint}" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 40 62 C 56 58 96 58 100 62 C 70 64 52 66 40 70 C 36 66 36 63 40 62 Z" fill="#1A2130" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
     <circle cx="100" cy="44" r="2.6" fill="#06080C"/>`,
  );
}
function durag(ctx: DrawCtx): string {
  return g(
    `<path d="M 52 70 C 50 42 70 30 100 30 C 130 30 150 42 148 70 C 116 58 84 58 52 70 Z" fill="#1A2130" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 148 64 C 160 66 168 76 162 92 C 158 84 152 78 144 76 Z" fill="#222B3D" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
     <path d="M 70 40 C 84 34 116 34 130 40" fill="none" stroke="${ctx.tint}" stroke-width="2" opacity="0.6"/>`,
  );
}

/* ── neckwear ────────────────────────────────────────────────────────── */

function noNeck(): string {
  return "";
}
function trenchCollar(ctx: DrawCtx): string {
  return g(
    `<path d="M 44 200 L 44 176 C 50 160 70 150 84 150 L 98 170 L 90 200 Z" fill="#3A3326" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 156 200 L 156 176 C 150 160 130 150 116 150 L 102 170 L 110 200 Z" fill="#3A3326" stroke="${ctx.ramp.outline}" stroke-width="3"/>
     <path d="M 84 150 L 98 172 L 88 156 Z" fill="#4A412F"/>
     <path d="M 116 150 L 102 172 L 112 156 Z" fill="#4A412F"/>
     ${rimLight("M 150 158 C 154 168 154 184 152 198", 0.4)}`,
  );
}
function chain(ctx: DrawCtx): string {
  return g(
    `<path d="M 72 158 Q 100 184 128 158" fill="none" stroke="#FFB627" stroke-width="5" stroke-linecap="round"/>
     <path d="M 72 158 Q 100 184 128 158" fill="none" stroke="#FFD56B" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
     <circle cx="100" cy="178" r="6" fill="#FFB627" stroke="${ctx.ramp.outline}" stroke-width="1.5"/>
     <text x="100" y="182" text-anchor="middle" font-size="8" font-weight="900" fill="#06080C" font-family="monospace">$</text>`,
  );
}
function scarf(ctx: DrawCtx): string {
  return g(
    `<path d="M 60 160 C 84 152 116 152 140 160 L 138 176 C 114 168 86 168 62 176 Z" fill="${ctx.tint}" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
     <path d="M 124 170 L 140 200 L 122 200 L 116 174 Z" fill="${ctx.tint}" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
     <path d="M 124 170 L 132 192" fill="none" stroke="#06080C" stroke-width="1.5" opacity="0.3"/>`,
  );
}

/* ── accessory ───────────────────────────────────────────────────────── */

function noAcc(): string {
  return "";
}
function cigar(): string {
  return g(
    `<rect x="108" y="124" width="34" height="6" rx="3" fill="#5A3A1E" stroke="#2A1B0E" stroke-width="1.5" transform="rotate(8 108 127)"/>
     <rect x="138" y="125" width="6" height="6" rx="2" fill="#3A2412" transform="rotate(8 138 128)"/>
     <circle cx="146" cy="129" r="3" fill="#FF6B3C"/>
     <circle cx="146" cy="129" r="1.4" fill="#FFD56B"/>
     <path d="M 148 126 Q 156 116 150 106 Q 162 112 156 100" fill="none" stroke="#8A94A6" stroke-width="1.6" opacity="0.5"/>`,
  );
}
function lockpick(ctx: DrawCtx): string {
  return g(
    `<g transform="translate(40 150) rotate(-18)">
       <rect x="0" y="0" width="32" height="4" rx="2" fill="#C9D4E2" stroke="${ctx.ramp.outline}" stroke-width="1"/>
       <path d="M 30 0 L 38 -4 L 38 2 Z" fill="#C9D4E2" stroke="${ctx.ramp.outline}" stroke-width="1"/>
       <rect x="-8" y="-3" width="10" height="10" rx="2" fill="#8A94A6" stroke="${ctx.ramp.outline}" stroke-width="1.2"/>
     </g>`,
  );
}
function coin(): string {
  return g(
    `<g transform="translate(150 160)">
       <circle r="11" fill="#FFB627" stroke="#06080C" stroke-width="2"/>
       <circle r="11" fill="none" stroke="#FFD56B" stroke-width="1.5" opacity="0.7"/>
       <path d="M 0 -6 L 1.8 -2 L 6 -1.8 L 2.8 1.2 L 4 5.4 L 0 3 L -4 5.4 L -2.8 1.2 L -6 -1.8 L -1.8 -2 Z" fill="#06080C"/>
       <ellipse cx="-4" cy="-4" rx="3" ry="2" fill="#fff" opacity="0.4"/>
     </g>`,
  );
}
function pigeon(ctx: DrawCtx): string {
  return g(
    `<g transform="translate(34 126)">
       <ellipse cx="12" cy="22" rx="12" ry="9.5" fill="#9AA6B8" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
       <ellipse cx="12" cy="22" rx="12" ry="9.5" fill="#7D8BA0" opacity="0.5" transform="translate(2 2)"/>
       <circle cx="20" cy="11" r="7" fill="#9AA6B8" stroke="${ctx.ramp.outline}" stroke-width="2.5"/>
       <circle cx="22" cy="10" r="1.5" fill="${ctx.ramp.outline}"/>
       <path d="M 27 12 L 33 13.5 L 27 15 Z" fill="#FFB627" stroke="${ctx.ramp.outline}" stroke-width="1.5"/>
       <path d="M 3 20 C 8 16 14 16 18 19" fill="none" stroke="${ctx.ramp.outline}" stroke-width="1.8"/>
       <ellipse cx="20" cy="5" rx="3.4" ry="1.8" fill="#3DDC97" opacity="0.85"/>
     </g>`,
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function dots(fill: string, pts: number[][]): string {
  return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${fill}"/>`).join("");
}
function rainStreaks(opacity: number): string {
  const lines: string[] = [];
  for (let i = 0; i < 18; i++) {
    const x = (i * 13 + (i % 3) * 5) % 200;
    const y = (i * 23) % 180;
    lines.push(`<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 14}" stroke="#9AC4E8" stroke-width="1" opacity="${opacity * 0.5}"/>`);
  }
  return `<g>${lines.join("")}</g>`;
}

/* ── trait tables ────────────────────────────────────────────────────── */

const opt = (id: string, label: string, draw: (c: DrawCtx) => string): TraitOption => ({ id, label, draw });

export const RACCOON_TRAITS: TraitTable = {
  background: [
    opt("alley", "Alley", alleyBg),
    opt("neon-rain", "Neon Rain", neonRainBg),
    opt("rooftop", "Rooftop", rooftopBg),
    opt("vault-glow", "Vault Glow", vaultGlowBg),
  ],
  fur: [
    // fur "trait" is the ramp choice; the silhouette is shared. The ramp itself
    // is selected in compose (rarity-weighted), so these options just label it.
    opt("ash-grey", "Ash Grey", raccoonBody),
    opt("gutter-brown", "Gutter Brown", raccoonBody),
    opt("slate-blue", "Slate Blue", raccoonBody),
    opt("smoke", "Smoke", raccoonBody),
    opt("rust-grey", "Rust Grey", raccoonBody),
  ],
  neckwear: [
    opt("none", "Bare", noNeck),
    opt("trench-collar", "Trench Collar", trenchCollar),
    opt("chain", "Gold Chain", chain),
    opt("scarf", "Scarf", scarf),
  ],
  expression: [
    opt("smirk", "Smirk", exprSmirk),
    opt("grit", "Grit", exprGrit),
    opt("deadpan", "Deadpan", exprDeadpan),
    opt("grin", "Grin", exprGrin),
  ],
  eyes: [
    opt("sly", "Sly", eyesSly),
    opt("wide", "Wide", eyesWide),
    opt("scarred", "Scarred", eyesScarred),
    opt("visor-glint", "Visor Glint", eyesVisorGlint),
  ],
  headwear: [
    opt("none", "None", noHat),
    opt("fedora", "Fedora", fedora),
    opt("beanie", "Beanie", beanie),
    opt("cap", "Cap", cap),
    opt("durag", "Durag", durag),
    opt("crown", "Crown", crown),
  ],
  accessory: [
    opt("none", "None", noAcc),
    opt("cigar", "Cigar", cigar),
    opt("lockpick", "Lockpick", lockpick),
    opt("coin", "Lucky Coin", coin),
    opt("pigeon", "Pigeon", pigeon),
  ],
};

/** Ramp name per fur trait id (compose uses this to resolve the colour ramp). */
export const RACCOON_FUR_RAMP: Record<string, string> = {
  "ash-grey": "ash-grey",
  "gutter-brown": "gutter-brown",
  "slate-blue": "slate-blue",
  smoke: "smoke",
  "rust-grey": "rust-grey",
};
