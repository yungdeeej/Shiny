/**
 * CharacterAvatar — layered, deterministic SVG busts.
 *
 * Parse dna hex → makeRng(dna) picks a 4-tone fur ramp, eye style, expression,
 * snout headwear and accessory tint. Cosmetic slugs render as layers on top.
 * Pure & memoizable. Refined to share the NFT studio's visual vocabulary
 * (ops/art): 4-tone ramps (shadow/base/mid/light), confident outlines, amber
 * rim-light from the right. Reads cleanly at 48px and 240px.
 *
 * Public API is unchanged: { dna, faction, cosmetics, size, className, dead }.
 */
import { makeRng } from "@trash-wars/economy";
import type { Faction } from "@trash-wars/shared";
import React, { useMemo } from "react";

interface Palette {
  /** darkest tone (cavities, ear insides) */
  shadow: string;
  /** the body fill */
  base: string;
  /** mid tone for form shading */
  mid: string;
  /** highlight (snout, brow patches) */
  light: string;
  outline: string;
}

const RACCOON_PALETTES: Palette[] = [
  { shadow: "#1E2532", base: "#8E9AA8", mid: "#A6B1BE", light: "#D7DEE8", outline: "#10141C" },
  { shadow: "#241F19", base: "#7C7468", mid: "#948A7C", light: "#D9CFC0", outline: "#120F0A" },
  { shadow: "#1A2230", base: "#6E7B8C", mid: "#8593A4", light: "#C9D4E2", outline: "#0E141D" },
  { shadow: "#23262C", base: "#7A8088", mid: "#929AA2", light: "#CDD2DA", outline: "#0D0F13" },
  { shadow: "#26211C", base: "#8A8276", mid: "#A29A8C", light: "#E2D9C8", outline: "#130F0B" },
];

const HOUND_PALETTES: Palette[] = [
  { shadow: "#3A2613", base: "#B98A56", mid: "#CC9C68", light: "#E8CCA0", outline: "#1E130A" },
  { shadow: "#2E1B0D", base: "#A4754A", mid: "#BB875A", light: "#D9B68C", outline: "#180D06" },
  { shadow: "#3F2A12", base: "#C09A6B", mid: "#D2AC7C", light: "#ECD3AC", outline: "#21160B" },
];

const TINTS = ["#FFB627", "#4D9DE0", "#C792EA", "#3DDC97", "#FF4D5E"];

export interface AvatarTraits {
  palette: Palette;
  eyeStyle: 0 | 1 | 2 | 3; // sly | wide | scarred | visor-glint
  expression: 0 | 1 | 2 | 3; // smirk | grit | deadpan | grin
  /** intrinsic (non-cosmetic) headwear: 0 none | 1 fedora | 2 cap */
  innateHat: 0 | 1 | 2;
  tint: string;
}

export function traitsFromDna(dna: string, faction: Faction): AvatarTraits {
  const rng = makeRng(dna || "stray");
  const palettes = faction === "bloodhound" ? HOUND_PALETTES : RACCOON_PALETTES;
  const palette = palettes[Math.floor(rng() * palettes.length)] ?? palettes[0]!;
  return {
    palette,
    eyeStyle: Math.floor(rng() * 4) as 0 | 1 | 2 | 3,
    expression: Math.floor(rng() * 4) as 0 | 1 | 2 | 3,
    // innate hats only for raccoons, and only sometimes (cosmetics override)
    innateHat: (faction === "bloodhound" ? 0 : rng() < 0.34 ? (rng() < 0.5 ? 1 : 2) : 0) as 0 | 1 | 2,
    tint: TINTS[Math.floor(rng() * TINTS.length)] ?? "#FFB627",
  };
}

function Eyes({ t, hound }: { t: AvatarTraits; hound: boolean }) {
  const { palette, eyeStyle, tint } = t;
  const eyeY = hound ? 92 : 90;
  const lx = 76;
  const rx = 124;
  const eyeWhite = hound ? "#F4E9D8" : "#EFF3F8";
  if (eyeStyle === 0) {
    // sly half-lidded
    return (
      <g>
        {[lx, rx].map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={eyeY} r="9" fill={eyeWhite} />
            <circle cx={x + 1.5} cy={eyeY + 1.5} r="4.4" fill={palette.outline} />
            <circle cx={x + 3} cy={eyeY} r="1.4" fill="#fff" opacity="0.9" />
            <path d={`M ${x - 10} ${eyeY - 4} A 10 10 0 0 1 ${x + 10} ${eyeY - 4} L ${x + 10} ${eyeY - 10} L ${x - 10} ${eyeY - 10} Z`} fill={palette.shadow} />
            <line x1={x - 9} y1={eyeY - 4.5} x2={x + 9} y2={eyeY - 4.5} stroke={palette.outline} strokeWidth="1.6" strokeLinecap="round" />
          </g>
        ))}
      </g>
    );
  }
  if (eyeStyle === 1) {
    // wide
    return (
      <g>
        {[lx, rx].map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={eyeY} r="10" fill={eyeWhite} />
            <circle cx={x + 1} cy={eyeY + 1} r="5.6" fill={palette.outline} />
            <circle cx={x + 3.4} cy={eyeY - 1.6} r="2" fill="#fff" />
          </g>
        ))}
      </g>
    );
  }
  if (eyeStyle === 3) {
    // visor-glint — glowing tint slit
    return (
      <g>
        <rect x={58} y={eyeY - 8} width={84} height={15} rx={7.5} fill="#06080C" stroke={palette.outline} strokeWidth="2.5" />
        <rect x={62} y={eyeY - 5} width={76} height={6} rx={3} fill={tint} opacity="0.9" />
        <rect x={66} y={eyeY - 4} width={20} height={3} rx={1.5} fill="#fff" opacity="0.65" />
        <circle cx={lx} cy={eyeY - 1.5} r={2.3} fill="#fff" opacity="0.85" />
        <circle cx={rx} cy={eyeY - 1.5} r={2.3} fill="#fff" opacity="0.85" />
      </g>
    );
  }
  // scarred: sly left eye + scar over right
  return (
    <g>
      <circle cx={lx} cy={eyeY} r="9" fill={eyeWhite} />
      <circle cx={lx + 1.5} cy={eyeY + 1.5} r="4.4" fill={palette.outline} />
      <circle cx={rx} cy={eyeY} r="8" fill={eyeWhite} />
      <circle cx={rx + 1} cy={eyeY + 1} r="4" fill={palette.outline} />
      <path d={`M ${lx - 10} ${eyeY - 4} A 10 10 0 0 1 ${lx + 10} ${eyeY - 4} L ${lx + 10} ${eyeY - 10} L ${lx - 10} ${eyeY - 10} Z`} fill={palette.shadow} />
      <line x1={rx - 4} y1={eyeY - 14} x2={rx + 5} y2={eyeY + 12} stroke={palette.light} strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
      <line x1={rx - 7} y1={eyeY - 7} x2={rx - 1} y2={eyeY - 9} stroke={palette.light} strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

function Mouth({ t }: { t: AvatarTraits }) {
  const { palette, expression } = t;
  if (expression === 0) {
    // smirk
    return <path d="M 90 124 Q 100 130 112 122" fill="none" stroke={palette.outline} strokeWidth="2.4" strokeLinecap="round" />;
  }
  if (expression === 1) {
    // grit — clenched teeth
    return (
      <g>
        <path d="M 88 123 Q 100 128 112 123" fill="none" stroke={palette.outline} strokeWidth="2.6" strokeLinecap="round" />
        <rect x="91" y="122.5" width="18" height="4.6" fill="#EFF3F8" opacity="0.85" />
        <line x1="95" y1="122.5" x2="95" y2="127" stroke={palette.outline} strokeWidth="1.4" />
        <line x1="101" y1="123" x2="101" y2="128" stroke={palette.outline} strokeWidth="1.4" />
        <line x1="107" y1="122.5" x2="107" y2="126.5" stroke={palette.outline} strokeWidth="1.4" />
      </g>
    );
  }
  if (expression === 3) {
    // grin — open, toothy
    return (
      <g>
        <path d="M 88 121 Q 100 135 112 121 Z" fill="#EFF3F8" stroke={palette.outline} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M 88 121 Q 100 124 112 121" fill="none" stroke={palette.outline} strokeWidth="1.4" />
        <path d="M 100 129 L 97 134 L 103 134 Z" fill="#FF8A8A" opacity="0.7" />
      </g>
    );
  }
  // deadpan
  return <line x1="92" y1="125" x2="110" y2="125" stroke={palette.outline} strokeWidth="2.4" strokeLinecap="round" />;
}

/** Innate (dna-driven) hat — only when no cosmetic hat is present. */
function InnateHat({ t }: { t: AvatarTraits }) {
  const p = t.palette;
  if (t.innateHat === 1) {
    // fedora
    return (
      <g>
        <path d="M 36 66 C 70 58 130 58 164 66 C 166 73 159 78 148 78 C 116 70 84 70 52 78 C 41 78 34 73 36 66 Z" fill="#26221B" stroke={p.outline} strokeWidth="3" />
        <path d="M 60 64 C 58 44 74 32 100 32 C 126 32 142 44 140 64 C 114 58 86 58 60 64 Z" fill="#33301F" stroke={p.outline} strokeWidth="3" />
        <path d="M 60 60 C 88 53 112 53 140 60 L 140 67 C 112 60 88 60 60 67 Z" fill={t.tint} opacity="0.9" />
      </g>
    );
  }
  if (t.innateHat === 2) {
    // cap
    return (
      <g>
        <path d="M 56 62 C 56 40 144 40 144 62 C 116 54 84 54 56 62 Z" fill={t.tint} stroke={p.outline} strokeWidth="3" />
        <path d="M 40 62 C 56 58 96 58 100 62 C 70 64 52 66 40 70 C 36 66 36 63 40 62 Z" fill="#1A2130" stroke={p.outline} strokeWidth="2.5" />
        <circle cx="100" cy="44" r="2.4" fill="#06080C" />
      </g>
    );
  }
  return null;
}

function RaccoonBust({ t }: { t: AvatarTraits }) {
  const p = t.palette;
  return (
    <g>
      {/* striped tail peeking over the right shoulder */}
      <g transform="translate(148 138) rotate(-35)">
        <rect x="-10" y="0" width="22" height="52" rx="11" fill={p.base} stroke={p.outline} strokeWidth="3" />
        <rect x="-10" y="10" width="22" height="9" fill={p.shadow} />
        <rect x="-10" y="28" width="22" height="9" fill={p.shadow} />
        <rect x="-10" y="44" width="22" height="8" rx="4" fill={p.shadow} />
        <rect x="-10" y="0" width="6" height="52" rx="3" fill={p.mid} opacity="0.5" />
      </g>
      {/* shoulders */}
      <path
        d="M 44 200 C 44 162 66 146 100 146 C 134 146 156 162 156 200 Z"
        fill={p.base}
        stroke={p.outline}
        strokeWidth="3.5"
      />
      <path d="M 100 146 C 134 146 156 162 156 200 L 138 200 C 138 170 122 154 100 150 Z" fill={p.shadow} opacity="0.4" />
      <path d="M 44 200 C 44 168 58 152 78 148 L 72 200 Z" fill={p.mid} opacity="0.35" />
      {/* chest fur notch */}
      <path d="M 92 152 L 100 164 L 108 152" fill="none" stroke={p.shadow} strokeWidth="2.5" strokeLinecap="round" />
      {/* ears */}
      <g>
        <path d="M 52 58 C 50 36 62 28 76 34 C 72 46 68 56 66 64 Z" fill={p.base} stroke={p.outline} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M 58 50 C 58 42 64 38 70 40 C 68 46 66 52 65 56 Z" fill={p.shadow} />
        <path d="M 148 58 C 150 36 138 28 124 34 C 128 46 132 56 134 64 Z" fill={p.base} stroke={p.outline} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M 142 50 C 142 42 136 38 130 40 C 132 46 134 52 135 56 Z" fill={p.shadow} />
      </g>
      {/* head */}
      <path
        d="M 100 44 C 134 44 152 66 152 94 C 152 124 132 142 100 142 C 68 142 48 124 48 94 C 48 66 66 44 100 44 Z"
        fill={p.base}
        stroke={p.outline}
        strokeWidth="3.5"
      />
      {/* form shading: mid tone on the shadow side, light catch on the lit side */}
      <path d="M 100 44 C 134 44 152 66 152 94 C 152 116 143 132 127 139 C 139 130 145 114 145 96 C 145 70 128 50 100 49 Z" fill={p.mid} opacity="0.5" />
      <path d="M 100 44 C 80 44 64 54 56 70 C 64 56 80 50 100 50 Z" fill={p.light} opacity="0.35" />
      {/* cheek tufts */}
      <path d="M 48 100 L 38 96 L 48 108 L 40 108 L 50 116" fill="none" stroke={p.outline} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 152 100 L 162 96 L 152 108 L 160 108 L 150 116" fill="none" stroke={p.outline} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* light eyebrow patches */}
      <path d="M 60 78 C 64 64 80 60 92 66 C 90 74 86 80 80 84 C 72 84 64 82 60 78 Z" fill={p.light} />
      <path d="M 140 78 C 136 64 120 60 108 66 C 110 74 114 80 120 84 C 128 84 136 82 140 78 Z" fill={p.light} />
      {/* the bandit mask band */}
      <path
        d="M 50 86 C 64 78 84 80 100 84 C 116 80 136 78 150 86 C 152 96 146 104 136 106 C 124 108 112 102 100 98 C 88 102 76 108 64 106 C 54 104 48 96 50 86 Z"
        fill={p.outline}
        stroke={p.outline}
        strokeWidth="2.5"
      />
      {/* snout patch */}
      <path d="M 78 108 C 86 102 114 102 122 108 C 128 118 120 134 100 134 C 80 134 72 118 78 108 Z" fill={p.light} />
      <path d="M 78 108 C 86 102 114 102 122 108 C 124 112 124 117 122 122 C 114 117 86 117 78 122 C 76 117 76 112 78 108 Z" fill="#fff" opacity="0.22" />
      {/* nose */}
      <path d="M 92 108 C 96 104 104 104 108 108 C 108 114 104 117 100 117 C 96 117 92 114 92 108 Z" fill={p.outline} />
      <circle cx="97" cy="108.5" r="1.6" fill="#fff" opacity="0.55" />
      {/* whisker dots */}
      <g fill={p.shadow} opacity="0.8">
        <circle cx="82" cy="118" r="1.2" />
        <circle cx="78" cy="122" r="1.2" />
        <circle cx="118" cy="118" r="1.2" />
        <circle cx="122" cy="122" r="1.2" />
      </g>
      <Eyes t={t} hound={false} />
      <Mouth t={t} />
      {/* amber rim light from the right */}
      <path
        d="M 148 70 C 154 82 154 106 146 122"
        fill="none"
        stroke="#FFB627"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path d="M 150 168 C 154 176 156 186 156 198" fill="none" stroke="#FFB627" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
    </g>
  );
}

function BloodhoundBust({ t }: { t: AvatarTraits }) {
  const p = t.palette;
  return (
    <g>
      {/* shoulders */}
      <path d="M 42 200 C 42 164 64 148 100 148 C 136 148 158 164 158 200 Z" fill={p.base} stroke={p.outline} strokeWidth="3.5" />
      <path d="M 100 148 C 136 148 158 164 158 200 L 140 200 C 140 172 124 156 100 152 Z" fill={p.shadow} opacity="0.4" />
      <path d="M 42 200 C 42 170 56 154 76 150 L 70 200 Z" fill={p.mid} opacity="0.35" />
      {/* long droopy ears (behind head) */}
      <path d="M 52 76 C 36 84 32 120 38 148 C 46 158 60 154 64 142 C 66 118 62 92 60 80 Z" fill={p.shadow} stroke={p.outline} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M 148 76 C 164 84 168 120 162 148 C 154 158 140 154 136 142 C 134 118 138 92 140 80 Z" fill={p.shadow} stroke={p.outline} strokeWidth="3.5" strokeLinejoin="round" />
      {/* head — long muzzle */}
      <path
        d="M 100 46 C 130 46 148 64 148 90 C 148 108 142 118 134 124 C 130 138 118 148 100 148 C 82 148 70 138 66 124 C 58 118 52 108 52 90 C 52 64 70 46 100 46 Z"
        fill={p.base}
        stroke={p.outline}
        strokeWidth="3.5"
      />
      <path d="M 100 46 C 130 46 148 64 148 90 C 148 106 143 116 135 122 C 142 112 144 98 142 88 C 138 66 122 52 100 52 Z" fill={p.mid} opacity="0.5" />
      <path d="M 100 46 C 82 46 68 56 60 72 C 68 58 82 52 100 52 Z" fill={p.light} opacity="0.35" />
      {/* forehead wrinkles */}
      <path d="M 78 62 Q 100 54 122 62" fill="none" stroke={p.shadow} strokeWidth="2.2" strokeLinecap="round" opacity="0.8" />
      <path d="M 82 70 Q 100 63 118 70" fill="none" stroke={p.shadow} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {/* jowls */}
      <path d="M 72 112 C 64 116 62 132 70 140 C 78 146 88 144 90 134 C 90 122 82 112 72 112 Z" fill={p.light} stroke={p.outline} strokeWidth="2.5" />
      <path d="M 128 112 C 136 116 138 132 130 140 C 122 146 112 144 110 134 C 110 122 118 112 128 112 Z" fill={p.light} stroke={p.outline} strokeWidth="2.5" />
      {/* muzzle */}
      <path d="M 84 104 C 90 98 110 98 116 104 C 122 114 116 132 100 132 C 84 132 78 114 84 104 Z" fill={p.light} />
      <path d="M 90 102 C 94 98 106 98 110 102 C 112 109 107 113 100 113 C 93 113 88 109 90 102 Z" fill={p.outline} />
      <circle cx="96" cy="103" r="1.8" fill="#fff" opacity="0.5" />
      {/* droopy hound eyes get a tired underline */}
      <Eyes t={t} hound />
      <path d="M 68 102 Q 76 106 84 102" fill="none" stroke={p.shadow} strokeWidth="1.8" opacity="0.65" />
      <path d="M 116 102 Q 124 106 132 102" fill="none" stroke={p.shadow} strokeWidth="1.8" opacity="0.65" />
      <Mouth t={t} />
      {/* collar + badge */}
      <path d="M 62 158 C 86 150 114 150 138 158 L 136 170 C 112 162 88 162 64 170 Z" fill="#22324a" stroke={p.outline} strokeWidth="2.5" />
      <path d="M 62 158 C 86 150 114 150 138 158 L 137 162 C 113 154 87 154 63 162 Z" fill="#4D9DE0" opacity="0.5" />
      <g transform="translate(100 170)">
        <circle r="9.5" fill="#FFB627" stroke={p.outline} strokeWidth="2" />
        <path d="M 0 -5.5 L 1.6 -1.8 L 5.6 -1.6 L 2.6 1 L 3.6 4.8 L 0 2.7 L -3.6 4.8 L -2.6 1 L -5.6 -1.6 L -1.6 -1.8 Z" fill={p.outline} />
      </g>
      {/* rim light */}
      <path d="M 144 72 C 150 84 150 104 144 118" fill="none" stroke="#FFB627" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </g>
  );
}

function Cosmetics({ slugs, t, faction }: { slugs: string[]; t: AvatarTraits; faction: Faction }) {
  const p = t.palette;
  const hatY = faction === "bloodhound" ? 0 : -2;
  return (
    <g>
      {slugs.includes("coat-trench") && (
        <g>
          <path d="M 44 200 L 44 178 C 50 162 70 150 84 150 L 96 168 L 88 200 Z" fill="#3A3326" stroke={p.outline} strokeWidth="3" />
          <path d="M 156 200 L 156 178 C 150 162 130 150 116 150 L 104 168 L 112 200 Z" fill="#3A3326" stroke={p.outline} strokeWidth="3" />
          <path d="M 84 150 L 98 172 L 88 156 Z" fill="#4A412F" />
          <path d="M 116 150 L 102 172 L 112 156 Z" fill="#4A412F" />
        </g>
      )}
      {slugs.includes("mask-visor") && (
        <g>
          <rect x="56" y="80" width="88" height="18" rx="9" fill={t.tint} opacity="0.85" />
          <rect x="56" y="80" width="88" height="18" rx="9" fill="none" stroke={p.outline} strokeWidth="2.5" />
          <rect x="62" y="84" width="40" height="4" rx="2" fill="#fff" opacity="0.5" />
        </g>
      )}
      {slugs.includes("hat-beanie") && (
        <g transform={`translate(0 ${hatY})`}>
          <path d="M 56 66 C 56 40 144 40 144 66 L 144 72 C 116 62 84 62 56 72 Z" fill={t.tint} stroke={p.outline} strokeWidth="3" />
          <path d="M 54 66 C 84 56 116 56 146 66 L 146 76 C 116 66 84 66 54 76 Z" fill="#1A2130" stroke={p.outline} strokeWidth="2.5" />
        </g>
      )}
      {slugs.includes("hat-fedora") && (
        <g transform={`translate(0 ${hatY})`}>
          <path d="M 38 68 C 70 60 130 60 162 68 C 164 74 158 78 148 78 C 116 70 84 70 52 78 C 42 78 36 74 38 68 Z" fill="#26221B" stroke={p.outline} strokeWidth="3" />
          <path d="M 62 66 C 60 46 74 34 100 34 C 126 34 140 46 138 66 C 114 60 86 60 62 66 Z" fill="#33301F" stroke={p.outline} strokeWidth="3" />
          <path d="M 62 62 C 88 55 112 55 138 62 L 138 68 C 112 61 88 61 62 68 Z" fill={t.tint} opacity="0.9" />
        </g>
      )}
      {slugs.includes("hat-crown") && (
        <g transform={`translate(0 ${hatY})`}>
          <path d="M 66 62 L 70 34 L 84 50 L 100 28 L 116 50 L 130 34 L 134 62 C 112 54 88 54 66 62 Z" fill="#FFB627" stroke={p.outline} strokeWidth="3" strokeLinejoin="round" />
          <circle cx="70" cy="34" r="3.5" fill="#FFD56B" stroke={p.outline} strokeWidth="2" />
          <circle cx="100" cy="28" r="3.5" fill="#FFD56B" stroke={p.outline} strokeWidth="2" />
          <circle cx="130" cy="34" r="3.5" fill="#FFD56B" stroke={p.outline} strokeWidth="2" />
        </g>
      )}
      {slugs.includes("companion-pigeon") && (
        <g transform="translate(38 128)">
          <ellipse cx="12" cy="22" rx="11" ry="9" fill="#9AA6B8" stroke={p.outline} strokeWidth="2.5" />
          <circle cx="20" cy="12" r="6.5" fill="#9AA6B8" stroke={p.outline} strokeWidth="2.5" />
          <circle cx="22" cy="11" r="1.4" fill={p.outline} />
          <path d="M 26 13 L 31 14.5 L 26 16 Z" fill="#FFB627" stroke={p.outline} strokeWidth="1.5" />
          <path d="M 4 21 C 8 17 14 17 18 20" fill="none" stroke={p.outline} strokeWidth="1.8" />
          <ellipse cx="20" cy="6" rx="3" ry="1.6" fill="#3DDC97" opacity="0.8" />
        </g>
      )}
    </g>
  );
}

const COSMETIC_HATS = ["hat-beanie", "hat-fedora", "hat-crown", "mask-visor"];

export interface CharacterAvatarProps {
  dna: string;
  faction: Faction;
  cosmetics?: string[];
  size?: number;
  className?: string;
  /** render the dead as a chalk outline */
  dead?: boolean;
}

export function CharacterAvatar({ dna, faction, cosmetics = [], size = 96, className, dead = false }: CharacterAvatarProps) {
  const t = useMemo(() => traitsFromDna(dna, faction), [dna, faction]);
  const bgId = `bg-${dna.slice(0, 8)}-${faction}`;
  // a cosmetic hat/visor takes precedence over the innate hat
  const hasCosmeticHat = cosmetics.some((c) => COSMETIC_HATS.includes(c));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label={`${faction} avatar`}
      style={dead ? { filter: "grayscale(1) brightness(0.7)" } : undefined}
    >
      <defs>
        <radialGradient id={bgId} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor={faction === "bloodhound" ? "#1c2b40" : "#222b3d"} />
          <stop offset="100%" stopColor="#0d1119" />
        </radialGradient>
        <clipPath id={`${bgId}-clip`}>
          <rect width="200" height="200" rx="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${bgId}-clip)`}>
        <rect width="200" height="200" fill={`url(#${bgId})`} />
        {/* faint amber rim glow from the right */}
        <ellipse cx="196" cy="96" rx="44" ry="90" fill="#FFB627" opacity="0.07" />
        {faction === "bloodhound" ? <BloodhoundBust t={t} /> : <RaccoonBust t={t} />}
        {!hasCosmeticHat && <InnateHat t={t} />}
        <Cosmetics slugs={cosmetics} t={t} faction={faction} />
        {dead && (
          <g stroke="#E8ECF4" strokeWidth="3" strokeDasharray="7 6" fill="none" opacity="0.9">
            <path d="M 100 44 C 134 44 152 66 152 94 C 152 124 132 142 100 142 C 68 142 48 124 48 94 C 48 66 66 44 100 44 Z" />
            <path d="M 44 200 C 44 162 66 146 100 146 C 134 146 156 162 156 200" />
          </g>
        )}
      </g>
      <rect width="200" height="200" rx="32" fill="none" stroke="#1F2735" strokeWidth="2" />
    </svg>
  );
}
