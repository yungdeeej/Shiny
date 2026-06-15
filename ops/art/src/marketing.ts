/**
 * marketing.ts — typed, code-drawn SVG card library for the doc-12 campaign.
 *
 * Every card is a pure (params) → SVG string function so the Sentinel can call
 * them headlessly and rasterize with render.ts. Noir palette throughout: deep
 * navy/charcoal grounds, amber $SHINY accents, rain + grain.
 *
 * All cards share buildCard() which lays down the ground, vignette, rain and
 * grain so individual cards only draw their subject + copy.
 */
import { PALETTE } from "./palette.js";
import { composeCharacter, tintFor } from "./compose.js";
import { pickTraits, rarityTier } from "./rarity.js";
import type { Faction } from "./traits/types.js";
import { makeRng } from "@trash-wars/economy";

export interface CardSize {
  w: number;
  h: number;
}

export const SIZES = {
  xHeader: { w: 1500, h: 500 },
  share: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  poster: { w: 1000, h: 1400 },
  sheet: { w: 1400, h: 1200 },
} as const;

/* ── shared chrome ───────────────────────────────────────────────────── */

function defs(): string {
  return `<defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0E1422"/><stop offset="60%" stop-color="#0A0E16"/><stop offset="100%" stop-color="#06080C"/></linearGradient>
    <radialGradient id="amberGlow" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#FFB627" stop-opacity="0.22"/><stop offset="100%" stop-color="#FFB627" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%"><stop offset="58%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.62)"/></radialGradient>
    <filter id="cardGrain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>`;
}

function skyline(w: number, h: number, seed = "skyline"): string {
  const rng = makeRng(seed);
  const base = h * 0.62;
  const bldgs: string[] = [];
  let x = -20;
  while (x < w + 20) {
    const bw = 40 + rng() * 70;
    const bh = 80 + rng() * (h * 0.42);
    const y = base - bh + 60;
    bldgs.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${bw.toFixed(0)}" height="${(h - y).toFixed(0)}" fill="#0C1220"/>`);
    // a few lit windows
    for (let i = 0; i < 6; i++) {
      if (rng() < 0.35) {
        const wx = x + 8 + rng() * (bw - 16);
        const wy = y + 14 + rng() * (bh - 28);
        bldgs.push(`<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="7" fill="#FFD56B" opacity="${(0.3 + rng() * 0.5).toFixed(2)}"/>`);
      }
    }
    x += bw + 6;
  }
  return `<g>${bldgs.join("")}</g>`;
}

function rain(w: number, h: number, density = 90, seed = "rain"): string {
  const rng = makeRng(seed);
  const lines: string[] = [];
  for (let i = 0; i < density; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = 12 + rng() * 18;
    lines.push(`<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - 5).toFixed(0)}" y2="${(y + len).toFixed(0)}" stroke="#9AC4E8" stroke-width="1" opacity="${(0.07 + rng() * 0.12).toFixed(2)}"/>`);
  }
  return `<g>${lines.join("")}</g>`;
}

function frame(w: number, h: number): string {
  return `<rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="18" fill="none" stroke="${PALETTE.accent}" stroke-width="2" opacity="0.35"/>`;
}

/** Wordmark: TRASH (solid) WARS (amber outline). */
function wordmark(x: number, y: number, size: number): string {
  return `<g font-family="'Arial Black','Arial',sans-serif" font-weight="900" font-size="${size}" letter-spacing="${(size * 0.02).toFixed(1)}">
    <text x="${x}" y="${y}" fill="${PALETTE.text}">TRASH</text>
    <text x="${x + size * 3.05}" y="${y}" fill="none" stroke="${PALETTE.accent}" stroke-width="${(size * 0.045).toFixed(2)}">WARS</text>
  </g>`;
}

function shinyTag(x: number, y: number, label: string, size = 26): string {
  return `<g><text x="${x}" y="${y}" font-family="monospace" font-weight="800" font-size="${size}" fill="${PALETTE.accent}">${esc(label)}</text></g>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap the subject layer in the standard ground+rain+grain card chrome. */
function buildCard(size: CardSize, inner: string, opts: { glow?: boolean; seed?: string } = {}): string {
  const { w, h } = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs()}
  <rect width="${w}" height="${h}" fill="url(#ground)"/>
  ${skyline(w, h, opts.seed ?? "sky")}
  ${opts.glow !== false ? `<rect width="${w}" height="${h}" fill="url(#amberGlow)"/>` : ""}
  ${inner}
  ${rain(w, h, Math.round((w * h) / 9000), opts.seed ?? "rain")}
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="${h}" filter="url(#cardGrain)" opacity="0.05" style="mix-blend-mode:overlay"/>
  ${frame(w, h)}
</svg>`;
}

/** Embed a composed avatar SVG inline at (x,y,size) by stripping its outer tag. */
function avatarLayer(faction: Faction, seedStr: string, x: number, y: number, size: number): string {
  const rng = makeRng(seedStr);
  const selection = pickTraits(faction, rng);
  const tint = tintFor(rng);
  const full = composeCharacter(faction, selection, { tint });
  // pull the inner content out of the 2048 artboard and rescale into `size`
  const inner = full.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const s = size / 2048;
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(5)})"><clipPath id="clip-${seedStr.replace(/[^a-z0-9]/gi, "")}"><rect width="2048" height="2048" rx="120"/></clipPath><g clip-path="url(#clip-${seedStr.replace(/[^a-z0-9]/gi, "")})">${inner}</g></g>`;
}

/* ── 1. Key art / teaser hero ────────────────────────────────────────── */

export interface HeroParams {
  size?: keyof typeof SIZES;
  tagline?: string;
  seed?: string;
}

/** "Raccoons cracking a safe under neon rain." */
export function heroCard(p: HeroParams = {}): string {
  const size = SIZES[p.size ?? "xHeader"];
  const { w, h } = size;
  const tagline = p.tagline ?? "THE CITY NEVER SLEEPS. NEITHER DO THE RACCOONS.";
  const seed = p.seed ?? "hero-1";

  // a cracked vault on the right, two raccoons mid-heist
  const vaultX = w * 0.62;
  const vaultY = h * 0.34;
  const vaultR = h * 0.28;
  const vault = `<g>
    <ellipse cx="${vaultX}" cy="${vaultY + vaultR}" rx="${vaultR * 1.3}" ry="${vaultR * 1.5}" fill="url(#amberGlow)"/>
    <circle cx="${vaultX}" cy="${vaultY + vaultR}" r="${vaultR}" fill="#10141C" stroke="#2A2415" stroke-width="14"/>
    <circle cx="${vaultX}" cy="${vaultY + vaultR}" r="${vaultR * 0.74}" fill="none" stroke="#FFB627" stroke-width="5" opacity="0.55"/>
    <circle cx="${vaultX}" cy="${vaultY + vaultR}" r="${vaultR * 0.4}" fill="#1A2130" stroke="#FFB627" stroke-width="4" opacity="0.7"/>
    ${Array.from({ length: 8 }).map((_, i) => { const a = (i / 8) * Math.PI * 2; return `<line x1="${vaultX}" y1="${vaultY + vaultR}" x2="${(vaultX + Math.cos(a) * vaultR * 0.9).toFixed(0)}" y2="${(vaultY + vaultR + Math.sin(a) * vaultR * 0.9).toFixed(0)}" stroke="#2A2415" stroke-width="4" opacity="0.6"/>`; }).join("")}
    <!-- coins spilling -->
    ${Array.from({ length: 14 }).map((_, i) => { const cx = vaultX - vaultR * 0.9 + (i * 11) % 60; const cy = vaultY + vaultR * 1.6 + (i % 4) * 9; return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="6" fill="#FFB627" stroke="#06080C" stroke-width="1.5"/>`; }).join("")}
  </g>`;

  const racc1 = avatarLayer("raccoon", `${seed}-a`, w * 0.04, h * 0.28, h * 0.62);
  const racc2 = avatarLayer("raccoon", `${seed}-b`, w * 0.26, h * 0.4, h * 0.5);

  const copy = `<g>
    ${wordmark(60, h - 120, 64)}
    <text x="60" y="${h - 72}" font-family="monospace" font-size="26" fill="${PALETTE.muted}" letter-spacing="3">${esc(tagline)}</text>
  </g>`;

  return buildCard(size, `${vault}${racc2}${racc1}${copy}`, { seed });
}

/* ── 2. Faction reveal cards ─────────────────────────────────────────── */

export interface FactionCardParams {
  faction: "raccoon" | "bloodhound" | "crow";
  seed?: string;
}

const FACTION_COPY: Record<string, { title: string; sub: string; color: string }> = {
  raccoon: { title: "THE RACCOONS", sub: "Masked, nimble, and allergic to honest work.", color: PALETTE.accent },
  bloodhound: { title: "BLOODHOUND PD", sub: "They eat what you lose. Stay off the radar.", color: PALETTE.pd },
  crow: { title: "THE CROWS", sub: "Coming soon. They've been watching the whole time.", color: PALETTE.jackpot },
};

export function factionCard(p: FactionCardParams): string {
  const size = SIZES.share;
  const { w, h } = size;
  const meta = FACTION_COPY[p.faction]!;
  const seed = p.seed ?? `faction-${p.faction}`;

  let subject: string;
  if (p.faction === "crow") {
    // teaser silhouette — a crow on a wire, eye glinting
    subject = `<g transform="translate(${w * 0.6} ${h * 0.18})">
      <ellipse cx="120" cy="180" rx="120" ry="150" fill="url(#amberGlow)" opacity="0.5"/>
      <path d="M 60 220 C 60 150 110 120 150 130 C 200 142 210 200 180 240 C 220 235 250 250 235 270 C 205 262 190 280 150 280 C 100 280 60 270 60 220 Z" fill="#06080C" stroke="#1A2130" stroke-width="3"/>
      <path d="M 150 130 C 160 110 175 105 188 110 C 178 122 168 130 160 138 Z" fill="#06080C"/>
      <path d="M 60 230 L 20 224 L 58 244 Z" fill="#FFB627"/>
      <circle cx="120" cy="168" r="7" fill="${PALETTE.jackpot}"/>
      <circle cx="121" cy="167" r="2.5" fill="#fff"/>
    </g>`;
  } else {
    subject = avatarLayer(p.faction, seed, w * 0.54, h * 0.06, h * 0.78);
  }

  const copy = `<g>
    <rect x="0" y="${h * 0.5}" width="6" height="${h * 0.42}" fill="${meta.color}"/>
    <text x="56" y="${h * 0.6}" font-family="'Arial Black',sans-serif" font-weight="900" font-size="68" fill="${PALETTE.text}">${esc(meta.title)}</text>
    <text x="58" y="${h * 0.6 + 46}" font-family="monospace" font-size="26" fill="${meta.color}">${esc(meta.sub)}</text>
    ${wordmark(58, h - 48, 30)}
  </g>`;

  return buildCard(size, `${subject}${copy}`, { seed });
}

/* ── 3. Trait showcase sheet ─────────────────────────────────────────── */

export interface SheetParams {
  count?: 12 | 24;
  faction?: "raccoon" | "bloodhound" | "mixed";
  seed?: string;
}

const RARITY_FRAME: Record<string, string> = {
  common: PALETTE.muted,
  rare: PALETTE.pd,
  epic: PALETTE.jackpot,
  legendary: PALETTE.accent,
};

export function traitSheet(p: SheetParams = {}): string {
  const size = SIZES.sheet;
  const { w, h } = size;
  const count = p.count ?? 24;
  const cols = count === 12 ? 4 : 6;
  const rows = count / cols;
  const seed = p.seed ?? "sheet";
  const rng = makeRng(`${seed}:layout`);

  const padX = 70;
  const padTop = 140;
  const cellW = (w - padX * 2) / cols;
  const cellH = (h - padTop - 70) / rows;
  const av = Math.min(cellW, cellH) * 0.82;

  const cells: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cx = padX + c * cellW + (cellW - av) / 2;
    const cy = padTop + r * cellH + (cellH - av) / 2;
    const faction: Faction =
      p.faction === "bloodhound" ? "bloodhound" : p.faction === "raccoon" ? "raccoon" : rng() < 0.18 ? "bloodhound" : "raccoon";
    const cseed = `${seed}:${i}`;
    // determine rarity for frame color
    const crng = makeRng(cseed);
    const sel = pickTraits(faction, crng);
    const tier = rarityTier(faction, sel);
    const frameColor = RARITY_FRAME[tier] ?? PALETTE.muted;
    cells.push(`<g>
      <rect x="${(cx - 8).toFixed(0)}" y="${(cy - 8).toFixed(0)}" width="${(av + 16).toFixed(0)}" height="${(av + 16).toFixed(0)}" rx="16" fill="#0C1018" stroke="${frameColor}" stroke-width="3"/>
      ${avatarLayer(faction, cseed, cx, cy, av)}
      <text x="${(cx + av / 2).toFixed(0)}" y="${(cy + av + 22).toFixed(0)}" text-anchor="middle" font-family="monospace" font-size="15" fill="${frameColor}">${tier.toUpperCase()}</text>
    </g>`);
  }

  const header = `<g>
    ${wordmark(70, 86, 44)}
    <text x="70" y="120" font-family="monospace" font-size="24" fill="${PALETTE.muted}" letter-spacing="2">THE COLLECTION — ${count} OF ${count === 12 ? "MANY" : "THOUSANDS"}, CODE-DRAWN</text>
  </g>`;

  return buildCard(size, `${header}${cells.join("")}`, { seed, glow: false });
}

/* ── 4. Most Wanted poster ───────────────────────────────────────────── */

export interface WantedParams {
  handle: string;
  bounty: string; // formatted $SHINY string
  faction?: "raccoon" | "bloodhound";
  crime?: string;
  seed?: string;
}

export function wantedPoster(p: WantedParams): string {
  const size = SIZES.poster;
  const { w, h } = size;
  const seed = p.seed ?? `wanted-${p.handle}`;
  const faction = p.faction ?? "raccoon";
  const crime = p.crime ?? "GRAND LARCENY · EVADING THE PD · BEING TOO SHINY";

  const av = w * 0.62;
  const avX = (w - av) / 2;
  const avY = h * 0.22;

  const inner = `<g>
    <rect x="50" y="50" width="${w - 100}" height="${h - 100}" rx="10" fill="#0D1320" stroke="#3A3326" stroke-width="4"/>
    <text x="${w / 2}" y="150" text-anchor="middle" font-family="'Arial Black',sans-serif" font-weight="900" font-size="92" fill="${PALETTE.danger}" letter-spacing="6">WANTED</text>
    <text x="${w / 2}" y="190" text-anchor="middle" font-family="monospace" font-size="24" fill="${PALETTE.muted}" letter-spacing="8">BY ORDER OF SHOREFRONT PD</text>
    <rect x="${avX - 10}" y="${avY - 10}" width="${av + 20}" height="${av + 20}" rx="14" fill="#0C1018" stroke="${PALETTE.accent}" stroke-width="4"/>
    ${avatarLayer(faction, seed, avX, avY, av)}
    <text x="${w / 2}" y="${avY + av + 70}" text-anchor="middle" font-family="'Arial Black',sans-serif" font-weight="900" font-size="56" fill="${PALETTE.text}">${esc(p.handle.toUpperCase())}</text>
    <text x="${w / 2}" y="${avY + av + 110}" text-anchor="middle" font-family="monospace" font-size="22" fill="${PALETTE.muted}">${esc(crime)}</text>
    <text x="${w / 2}" y="${h - 150}" text-anchor="middle" font-family="monospace" font-size="26" fill="${PALETTE.muted}" letter-spacing="4">REWARD</text>
    <text x="${w / 2}" y="${h - 90}" text-anchor="middle" font-family="'Arial Black',sans-serif" font-weight="900" font-size="64" fill="${PALETTE.accent}">${esc(p.bounty)}</text>
  </g>`;

  return buildCard(size, inner, { seed });
}

/* ── 5. Weekly burn + Monday stats cards ─────────────────────────────── */

export interface BurnCardParams {
  amount: string; // e.g. "14.2M $SHINY"
  txSig?: string;
  weekLabel?: string;
  seed?: string;
}

export function burnCard(p: BurnCardParams): string {
  const size = SIZES.share;
  const { w, h } = size;
  const seed = p.seed ?? "burn";
  const furnace = `<g transform="translate(${w * 0.62} ${h * 0.18})">
    <ellipse cx="170" cy="240" rx="220" ry="200" fill="url(#amberGlow)"/>
    <rect x="60" y="120" width="220" height="280" rx="14" fill="#10141C" stroke="#2A2415" stroke-width="8"/>
    <path d="M 100 250 C 120 200 150 230 170 190 C 190 230 220 200 240 250 C 250 320 210 360 170 360 C 130 360 90 320 100 250 Z" fill="#FF6B3C"/>
    <path d="M 130 280 C 145 245 160 265 170 240 C 180 265 195 245 210 280 C 216 320 195 345 170 345 C 145 345 124 320 130 280 Z" fill="#FFB627"/>
    <path d="M 152 300 C 160 282 165 292 170 280 C 175 292 180 282 188 300 C 192 320 182 332 170 332 C 158 332 148 320 152 300 Z" fill="#FFD56B"/>
  </g>`;
  const inner = `<g>
    <text x="60" y="${h * 0.36}" font-family="'Arial Black',sans-serif" font-weight="900" font-size="56" fill="${PALETTE.text}">WEEKLY BURN</text>
    <text x="62" y="${h * 0.36 + 44}" font-family="monospace" font-size="24" fill="${PALETTE.muted}">${esc(p.weekLabel ?? "SUNDAY · ON-CHAIN · RECEIPTED")}</text>
    <text x="60" y="${h * 0.62}" font-family="'Arial Black',sans-serif" font-weight="900" font-size="88" fill="${PALETTE.accent}">${esc(p.amount)}</text>
    ${p.txSig ? `<text x="62" y="${h * 0.62 + 40}" font-family="monospace" font-size="20" fill="${PALETTE.muted}">tx ${esc(p.txSig.slice(0, 16))}…</text>` : ""}
    ${wordmark(60, h - 44, 28)}
  </g>${furnace}`;
  return buildCard(size, inner, { seed });
}

export interface StatsCardParams {
  rows: { label: string; value: string }[];
  title?: string;
  seed?: string;
}

export function statsCard(p: StatsCardParams): string {
  const size = SIZES.share;
  const { w, h } = size;
  const seed = p.seed ?? "stats";
  const rows = p.rows.slice(0, 5);
  const startY = 210;
  const rowH = (h - startY - 80) / Math.max(rows.length, 1);
  const rowSvg = rows
    .map((r, i) => {
      const y = startY + i * rowH;
      return `<g>
        <text x="70" y="${(y + rowH * 0.5).toFixed(0)}" font-family="monospace" font-size="30" fill="${PALETTE.muted}">${esc(r.label)}</text>
        <text x="${w - 70}" y="${(y + rowH * 0.5).toFixed(0)}" text-anchor="end" font-family="'Arial Black',sans-serif" font-weight="900" font-size="40" fill="${PALETTE.accent}">${esc(r.value)}</text>
        <line x1="70" y1="${(y + rowH - 8).toFixed(0)}" x2="${w - 70}" y2="${(y + rowH - 8).toFixed(0)}" stroke="${PALETTE.line}" stroke-width="2" opacity="0.6"/>
      </g>`;
    })
    .join("");
  const inner = `<g>
    ${wordmark(70, 120, 44)}
    <text x="70" y="160" font-family="monospace" font-size="26" fill="${PALETTE.muted}" letter-spacing="3">${esc(p.title ?? "THE MONDAY LEDGER — SHOREFRONT CITY")}</text>
    ${rowSvg}
  </g>`;
  return buildCard(size, inner, { seed, glow: false });
}

/* ── 6. Mint Vault / jackpot teaser ──────────────────────────────────── */

export interface VaultCardParams {
  amount: string; // e.g. "2,418,900 $SHINY"
  climbing?: boolean;
  seed?: string;
}

export function vaultTeaser(p: VaultCardParams): string {
  const size = SIZES.share;
  const { w, h } = size;
  const seed = p.seed ?? "vault";
  const cx = w / 2;
  const ring = `<g>
    <ellipse cx="${cx}" cy="${h * 0.38}" rx="280" ry="220" fill="url(#amberGlow)"/>
    <circle cx="${cx}" cy="${h * 0.38}" r="150" fill="#10141C" stroke="#2A2415" stroke-width="16"/>
    <circle cx="${cx}" cy="${h * 0.38}" r="110" fill="none" stroke="${PALETTE.accent}" stroke-width="6" opacity="0.6"/>
    <circle cx="${cx}" cy="${h * 0.38}" r="58" fill="#1A2130" stroke="${PALETTE.accent}" stroke-width="5" opacity="0.75"/>
    ${Array.from({ length: 12 }).map((_, i) => { const a = (i / 12) * Math.PI * 2; return `<line x1="${cx}" y1="${h * 0.38}" x2="${(cx + Math.cos(a) * 138).toFixed(0)}" y2="${(h * 0.38 + Math.sin(a) * 138).toFixed(0)}" stroke="#2A2415" stroke-width="5" opacity="0.5"/>`; }).join("")}
  </g>`;
  const inner = `<g>
    ${ring}
    <text x="${cx}" y="${h * 0.72}" text-anchor="middle" font-family="'Arial Black',sans-serif" font-weight="900" font-size="40" fill="${PALETTE.text}" letter-spacing="6">THE VAULT</text>
    <text x="${cx}" y="${h * 0.84}" text-anchor="middle" font-family="'Arial Black',sans-serif" font-weight="900" font-size="64" fill="${PALETTE.accent}">${esc(p.amount)}</text>
    <text x="${cx}" y="${h * 0.84 + 38}" text-anchor="middle" font-family="monospace" font-size="24" fill="${PALETTE.jackpot}" letter-spacing="4">${p.climbing === false ? "SEALED — OPENS S1 WK8" : "AND CLIMBING"}</text>
  </g>`;
  return buildCard(size, inner, { seed });
}
