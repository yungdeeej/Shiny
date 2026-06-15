/**
 * card.ts — minimal, self-contained noir SVG card generator for Sentinel
 * attachments. The art-studio (ops/art) owns the full marketing library, but the
 * Sentinel ships with only zod, so we replicate a *minimal* card here rather
 * than take a cross-package dependency.
 *
 * Always writes an .svg (dependency-free). When `sharp` happens to be importable
 * (it is not in beta), it also rasterizes a .png — same graceful-degradation
 * pattern as the Anthropic/FAL paths.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StoryEvent, StoryKind } from "./consume.js";

const C = {
  text: "#E8ECF4",
  muted: "#8A94A6",
  accent: "#FFB627",
  pd: "#4D9DE0",
  danger: "#FF4D5E",
  jackpot: "#C792EA",
  success: "#3DDC97",
} as const;

const ACCENT: Record<StoryKind, string> = {
  jackpot: C.jackpot,
  death: C.danger,
  confiscation: C.pd,
  raffle: C.success,
  burn: C.accent,
  mint: C.jackpot,
  "faction-war": C.pd,
};

const KICKER: Record<StoryKind, string> = {
  jackpot: "JACKPOT",
  death: "OBITUARY",
  confiscation: "PD SHAKEDOWN",
  raffle: "RAFFLE NIGHT",
  burn: "WEEKLY BURN",
  mint: "MINT WAVE",
  "faction-war": "TURF WAR",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** word-wrap a string to <= width chars/line, returns up to maxLines lines. */
function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

function skyline(w: number, h: number, seed: number): string {
  let s = seed >>> 0;
  const rng = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: string[] = [];
  let x = -20;
  while (x < w + 20) {
    const bw = 36 + rng() * 64;
    const bh = 70 + rng() * (h * 0.4);
    const y = h * 0.62 - bh + 50;
    out.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${bw.toFixed(0)}" height="${(h - y).toFixed(0)}" fill="#0C1220"/>`);
    for (let i = 0; i < 5; i++) {
      if (rng() < 0.32) {
        out.push(
          `<rect x="${(x + 6 + rng() * (bw - 12)).toFixed(0)}" y="${(y + 12 + rng() * (bh - 24)).toFixed(0)}" width="4" height="6" fill="#FFD56B" opacity="${(0.3 + rng() * 0.4).toFixed(2)}"/>`,
        );
      }
    }
    x += bw + 6;
  }
  return `<g>${out.join("")}</g>`;
}

export interface CardCopy {
  headline: string;
  kicker?: string;
  stat?: string; // big number line (amount / multiplier)
}

/** Build a 1200×630 share-card SVG for a story event. */
export function buildCardSvg(evt: StoryEvent, copy: CardCopy): string {
  const w = 1200;
  const h = 630;
  const accent = ACCENT[evt.kind];
  const kicker = copy.kicker ?? KICKER[evt.kind];
  const seedNum = [...evt.sourceId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
  const headlineLines = wrap(copy.headline, 30, 3);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0E1422"/><stop offset="60%" stop-color="#0A0E16"/><stop offset="100%" stop-color="#06080C"/></linearGradient>
    <radialGradient id="glow" cx="50%" cy="36%" r="60%"><stop offset="0%" stop-color="${accent}" stop-opacity="0.18"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%"><stop offset="58%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.62)"/></radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${skyline(w, h, seedNum)}
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <rect x="60" y="86" width="10" height="${h - 200}" fill="${accent}"/>
  <text x="92" y="120" font-family="monospace" font-weight="800" font-size="28" letter-spacing="8" fill="${accent}">THE SHOREFRONT SENTINEL · ${esc(kicker)}</text>
  ${headlineLines
    .map((line, i) => `<text x="90" y="${210 + i * 78}" font-family="'Arial Black','Arial',sans-serif" font-weight="900" font-size="64" fill="${C.text}">${esc(line)}</text>`)
    .join("\n  ")}
  ${copy.stat ? `<text x="90" y="${230 + headlineLines.length * 78 + 30}" font-family="'Arial Black',sans-serif" font-weight="900" font-size="74" fill="${accent}">${esc(copy.stat)}</text>` : ""}
  <g font-family="'Arial Black',sans-serif" font-weight="900" font-size="30">
    <text x="90" y="${h - 50}" fill="${C.text}">TRASH</text>
    <text x="178" y="${h - 50}" fill="none" stroke="${accent}" stroke-width="1.4">WARS</text>
  </g>
  <text x="${w - 70}" y="${h - 50}" text-anchor="end" font-family="monospace" font-size="22" fill="${C.muted}">${esc(evt.at.slice(0, 10))}</text>
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.05" style="mix-blend-mode:overlay"/>
  <rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="18" fill="none" stroke="${accent}" stroke-width="2" opacity="0.32"/>
</svg>`;
}

/** Derive card copy (kicker + big stat) from a story event. */
export function cardCopyFor(evt: StoryEvent, headline: string): CardCopy {
  let stat: string | undefined;
  if (evt.kind === "jackpot" && evt.multiplierX !== undefined) stat = `${evt.multiplierX}× HAUL`;
  else if (evt.kind === "confiscation" && evt.amount !== undefined) stat = `${evt.amount.toLocaleString("en-US")} $SHINY`;
  else if (evt.kind === "burn" && evt.amount !== undefined) stat = `${evt.amount.toLocaleString("en-US")} $SHINY`;
  return { headline, stat };
}

export interface RenderedCard {
  svgPath: string;
  pngPath: string | null;
  note: string;
}

/**
 * Write the card. Always emits .svg. Rasterizes .png only if `sharp` is
 * importable (it is not in the beta sentinel dep set) — otherwise the SVG is the
 * deliverable and ops/art's gen:marketing produces the polished PNG variants.
 */
export async function writeCard(outDir: string, baseName: string, svg: string): Promise<RenderedCard> {
  mkdirSync(outDir, { recursive: true });
  const svgPath = path.join(outDir, `${baseName}.svg`);
  writeFileSync(svgPath, svg);

  try {
    // sharp is NOT a sentinel dependency in beta; the variable specifier keeps
    // tsc from resolving it statically. Present only if the host happens to have
    // it (e.g. a combined deploy with ops/art) — otherwise we fall through.
    const sharpSpecifier = "sharp";
    const sharpMod = (await import(sharpSpecifier)) as unknown as {
      default: (b: Buffer) => { png: () => { toBuffer: () => Promise<Buffer> } };
    };
    const sharp = sharpMod.default;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const pngPath = path.join(outDir, `${baseName}.png`);
    writeFileSync(pngPath, png);
    return { svgPath, pngPath, note: `rendered card → ${pngPath}` };
  } catch {
    return {
      svgPath,
      pngPath: null,
      note: `card SVG written → ${svgPath} (sharp not installed for sentinel; run \`pnpm --filter @trash-wars/art-studio gen:marketing\` for polished PNGs)`,
    };
  }
}
