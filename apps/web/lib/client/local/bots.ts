/**
 * Deterministic ambient-city simulation. Every function here is a pure function
 * of (seeded rng, time) so the city looks alive and *coherent across reloads*:
 * the same second always produces the same feed event, heat level and
 * leaderboard totals.
 */
import {
  SEASON1,
  SEASON1_LOCATIONS,
  heatBandForWeight,
  makeRng,
  sha256Hex,
} from "@trash-wars/economy";
import {
  formatShiny,
  toBaseUnits,
  type FeedEvent,
  type HeatBand,
  type LeaderboardEntry,
  type LocationConfig,
} from "@trash-wars/shared";
import { BOT_NAMES } from "./content";
import type { LeaderboardBoard } from "../types";

export interface Bot {
  name: string;
  faction: "raccoon" | "bloodhound";
  dna: string;
  /** whole-SHINY earn rate per real hour — drives leaderboards */
  earnRate: number;
  heistPeak: number;
  confiscatedTotal: number;
  rep: number;
}

/** Season anchor (real time) — the world has been running since this moment. */
export const SEASON_START_MS = Date.parse("2026-05-21T00:00:00Z");

export const BOTS: Bot[] = (() => {
  const rng = makeRng("shorefront-city");
  return BOT_NAMES.map((entry) => ({
    name: entry.name,
    faction: entry.faction,
    dna: sha256Hex(`bot:${entry.name}`),
    earnRate: 40 + Math.floor(rng() * 700),
    heistPeak: 2_000 + Math.floor(rng() * 180_000),
    confiscatedTotal: Math.floor(rng() * 90_000),
    rep: 1 + Math.floor(rng() * 9),
  }));
})();

const LOCATIONS = SEASON1_LOCATIONS;

function locByIndex(i: number): LocationConfig {
  const loc = LOCATIONS[Math.abs(i) % LOCATIONS.length];
  if (!loc) throw new Error("no locations");
  return loc;
}

/* ── Feed events ──────────────────────────────────────────────────── */

export const FEED_BUCKET_MS = 9_000;

export function bucketIndex(t: number): number {
  return Math.floor(t / FEED_BUCKET_MS);
}

const AMOUNT_BANDS = ["under 1K", "1K–5K", "5K–20K", "20K–80K", "80K+"] as const;

/** Deterministic feed event for a time bucket; ~30% of buckets are quiet. */
export function feedEventForBucket(i: number): FeedEvent | null {
  const rng = makeRng(`feed:${i}`);
  if (rng() < 0.3) return null;
  const bot = BOTS[Math.floor(rng() * BOTS.length)];
  if (!bot) return null;
  const loc = locByIndex(Math.floor(rng() * LOCATIONS.length));
  const at = new Date(i * FEED_BUCKET_MS + Math.floor(rng() * 4000)).toISOString();
  const band = AMOUNT_BANDS[Math.min(AMOUNT_BANDS.length - 1, Math.floor(rng() * rng() * AMOUNT_BANDS.length))] ?? "1K–5K";
  const roll = rng();
  const id = `bot-feed-${i}`;

  if (bot.faction === "bloodhound" || roll < 0.1) {
    const hound = bot.faction === "bloodhound" ? bot : BOTS[33] ?? bot;
    if (roll < 0.5) {
      return {
        id, type: "patrol", locationSlug: loc.slug, actor: hound.name, at,
        message: `${hound.name} started a patrol shift at ${loc.name}`,
      };
    }
    const seized = 1_000 + Math.floor(rng() * 40_000);
    return {
      id, type: "confiscation", locationSlug: loc.slug, actor: hound.name, at,
      amountBand: band,
      message: `${hound.name} seized ${seized.toLocaleString("en-US")} $SHINY in evidence at ${loc.name}`,
    };
  }

  if (roll < 0.45) {
    const winRow = loc.table.find((r) => r.outcome === "win");
    const mult = (winRow?.multiplierBps ?? 14_000) / 10_000;
    return {
      id, type: "win", locationSlug: loc.slug, actor: bot.name, at,
      multiplierBps: winRow?.multiplierBps, amountBand: band,
      message: `${bot.name} hit ${mult.toFixed(1)}× at ${loc.name}`,
    };
  }
  if (roll < 0.48 && loc.slug === "the-mint") {
    return {
      id, type: "jackpot", locationSlug: loc.slug, actor: bot.name, at,
      multiplierBps: 120_000, amountBand: "80K+",
      message: `JACKPOT — ${bot.name} cracked The Mint for 12×`,
    };
  }
  if (roll < 0.62) {
    return {
      id, type: "arrest", locationSlug: loc.slug, actor: bot.name, at,
      message: `${bot.name} got booked at ${loc.name} — 24h in the tank`,
    };
  }
  if (roll < 0.72) {
    return {
      id, type: "confiscation", locationSlug: loc.slug, actor: bot.name, at, amountBand: band,
      message: `PD confiscated ${bot.name}'s stake at ${loc.name}`,
    };
  }
  if (roll < 0.78) {
    return {
      id, type: "rekt", locationSlug: loc.slug, actor: bot.name, at,
      message: `${bot.name} didn't make it out of ${loc.name}`,
    };
  }
  if (roll < 0.85) {
    return {
      id, type: "mint", actor: bot.name, at,
      message: `${bot.name} minted a fresh ${rng() < 0.85 ? "raccoon" : "bloodhound"} — 25,000 $SHINY burned`,
    };
  }
  if (roll < 0.92) {
    const burned = 500 + Math.floor(rng() * 4_000);
    return {
      id, type: "burn", actor: bot.name, at,
      message: `${bot.name} burned ${burned.toLocaleString("en-US")} $SHINY on upgrades`,
    };
  }
  return {
    id, type: "bribe", locationSlug: loc.slug, actor: bot.name, at,
    message: `${bot.name} slipped the patrol an envelope at ${loc.name}`,
  };
}

/** Last `count` non-null events at time t, oldest first. */
export function recentFeed(t: number, count: number): FeedEvent[] {
  const out: FeedEvent[] = [];
  let i = bucketIndex(t);
  let guard = 0;
  while (out.length < count && guard < count * 4) {
    const ev = feedEventForBucket(i);
    if (ev) out.unshift(ev);
    i -= 1;
    guard += 1;
  }
  return out;
}

/* ── Heat / player counts ─────────────────────────────────────────── */

const BASE_WEIGHT: Record<string, number> = {
  "corner-store": 0.4,
  "pawn-shop": 1.1,
  "jewelry-district": 2.2,
  "armored-truck": 2.8,
  "first-national": 4.2,
  "the-mint": 6,
};

/** Ambient (bot) patrol weight at a location — slow deterministic wander. */
export function ambientPatrolWeight(slug: string, t: number): number {
  const loc = LOCATIONS.find((l) => l.slug === slug);
  const base = BASE_WEIGHT[slug] ?? 1;
  // two incommensurate sine waves + per-slug phase = slow believable wander
  const phase = sha256Hex(slug).charCodeAt(0);
  const wave =
    Math.sin(t / 480_000 + phase) * 0.9 + Math.sin(t / 1_730_000 + phase * 2) * 1.1;
  const w = Math.max(0, base + wave);
  return Math.min(w, loc?.patrolWeightCap ?? w);
}

export function heatAt(slug: string, t: number, playerWeight: number): HeatBand {
  return heatBandForWeight(ambientPatrolWeight(slug, t) + playerWeight);
}

export function playersActiveAt(slug: string, t: number): number {
  const base: Record<string, number> = {
    "corner-store": 38,
    "pawn-shop": 24,
    "jewelry-district": 17,
    "armored-truck": 12,
    "first-national": 8,
    "the-mint": 5,
  };
  const phase = sha256Hex(`pa:${slug}`).charCodeAt(0);
  const wave = Math.sin(t / 300_000 + phase) * 0.35 + Math.sin(t / 47_000 + phase) * 0.12;
  return Math.max(1, Math.round((base[slug] ?? 10) * (1 + wave)));
}

/* ── Leaderboards ─────────────────────────────────────────────────── */

const u = (whole: number): string => toBaseUnits(Math.max(0, Math.round(whole))).toString();

export function botLeaderboard(board: LeaderboardBoard, t: number): LeaderboardEntry[] {
  const hours = Math.max(1, (t - SEASON_START_MS) / 3_600_000);
  let rows: Array<{ handle: string; faction: "raccoon" | "bloodhound"; value: number; detail?: string }>;
  switch (board) {
    case "earners":
      rows = BOTS.filter((b) => b.faction === "raccoon").map((b) => ({
        handle: b.name, faction: b.faction,
        value: b.earnRate * hours * (0.7 + (b.rep % 5) * 0.1),
        detail: "net heist profit",
      }));
      break;
    case "hounds":
      rows = BOTS.filter((b) => b.faction === "bloodhound").map((b) => ({
        handle: b.name, faction: b.faction,
        value: b.earnRate * hours * 0.5 * (1 + b.rep * 0.25),
        detail: `rep ${b.rep}`,
      }));
      break;
    case "heists":
      rows = BOTS.filter((b) => b.faction === "raccoon").map((b) => ({
        handle: b.name, faction: b.faction,
        value: b.heistPeak,
        detail: "single payout",
      }));
      break;
    case "most_wanted":
      rows = BOTS.filter((b) => b.faction === "raccoon").map((b) => ({
        handle: b.name, faction: b.faction,
        value: b.confiscatedTotal + (b.earnRate / 10) * hours * 0.4,
        detail: "total confiscated",
      }));
      break;
  }
  rows.sort((a, b) => b.value - a.value);
  return rows.slice(0, 25).map((r, i) => ({
    rank: i + 1,
    handle: r.handle,
    faction: r.faction,
    value: u(r.value),
    detail: r.detail,
  }));
}

/* ── Public stats / supply ────────────────────────────────────────── */

export function syntheticPublicStats(t: number, playerBurned: bigint, playerRaked: bigint) {
  const seasonDay = Math.max(1, Math.min(SEASON1.days, Math.floor((t - SEASON_START_MS) / 86_400_000) + 1));
  const hours = Math.max(1, (t - SEASON_START_MS) / 3_600_000);
  const emissionsSpent = (SEASON1.dailyBudget * BigInt(Math.floor(hours * 0.58 * 100))) / (24n * 100n);
  const burnedBots = toBaseUnits(Math.floor(hours * 41_000));
  const burnedTotal = burnedBots + playerBurned;
  const circulating = toBaseUnits(120_000_000) + emissionsSpent - burnedTotal;
  return {
    circulating: circulating.toString(),
    burnedTotal: burnedTotal.toString(),
    burnedThisWeek: toBaseUnits(Math.floor(Math.min(hours, 168) * 41_000)).toString(),
    emissionsSpent: emissionsSpent.toString(),
    emissionsBudget: SEASON1.emissions.toString(),
    seasonDay,
    seasonLengthDays: SEASON1.days,
    pdApr: 0.42 + 0.18 * Math.sin(t / 7_000_000),
    players: 1_180 + Math.floor(80 * Math.sin(t / 9_000_000)) + Math.floor(hours / 8),
    missionsToday: 3_900 + Math.floor(600 * Math.sin(t / 2_000_000)),
    biggestHeistThisWeek: toBaseUnits(184_500).toString(),
    treasuryRake: (toBaseUnits(Math.floor(hours * 9_000)) + playerRaked).toString(),
  };
}

/** Weekly burn history rows for /transparency. */
export function weeklyBurns(t: number): Array<{ week: number; burned: string }> {
  const weeks = Math.max(1, Math.min(13, Math.ceil((t - SEASON_START_MS) / (7 * 86_400_000))));
  const rng = makeRng("weekly-burns");
  const out: Array<{ week: number; burned: string }> = [];
  for (let w = 1; w <= weeks; w++) {
    out.push({ week: w, burned: toBaseUnits(Math.floor(4_200_000 + rng() * 3_500_000)).toString() });
  }
  return out;
}

/* ── Raffles / mints / market ambient pressure ────────────────────── */

export function botTicketsSold(opensAtMs: number, t: number): number {
  return Math.max(3, Math.floor((t - opensAtMs) / 18_000));
}

export function botMintTaken(faction: "raccoon" | "bloodhound", t: number): number {
  const hours = Math.max(0, (t - SEASON_START_MS) / 3_600_000);
  return faction === "raccoon" ? Math.floor(hours * 0.62) : Math.floor(hours * 0.055);
}

export interface BotListingSeed {
  id: string;
  name: string;
  seller: string;
  dna: string;
  stats: { stealth: number; muscle: number; luck: number; reputation: number };
  level: number;
  price: string;
  createdAt: string;
}

/** A rotating set of bot market listings, stable within a 10-minute window. */
export function botListings(t: number): BotListingSeed[] {
  const windowIdx = Math.floor(t / 600_000);
  const out: BotListingSeed[] = [];
  for (let k = 0; k < 5; k++) {
    const rng = makeRng(`listing:${windowIdx - k}:${k}`);
    const bot = BOTS[Math.floor(rng() * 30)];
    if (!bot || bot.faction !== "raccoon") continue;
    const stealth = 1 + Math.floor(rng() * 5);
    const muscle = 1 + Math.floor(rng() * 5);
    const luck = 1 + Math.floor(rng() * 4);
    const invested = stealth + muscle + luck - 3;
    const price = 25_000 + invested * 2_000 + Math.floor(rng() * 9_000);
    out.push({
      id: `bot-listing-${windowIdx - k}-${k}`,
      name: `${bot.name}'s Protégé`,
      seller: bot.name,
      dna: sha256Hex(`listing:${windowIdx - k}:${k}`),
      stats: { stealth, muscle, luck, reputation: 1 },
      level: 1 + Math.floor(invested / 2),
      price: toBaseUnits(price).toString(),
      createdAt: new Date((windowIdx - k) * 600_000).toISOString(),
    });
  }
  return out;
}

/** Tiny deterministic price history for market sparklines. */
export function priceHistory(seedKey: string, points: number): number[] {
  const rng = makeRng(`prices:${seedKey}`);
  let p = 24_000 + rng() * 8_000;
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    p = Math.max(15_000, p * (0.97 + rng() * 0.07));
    out.push(Math.round(p));
  }
  return out;
}

export function formatBand(amount: bigint): string {
  const whole = Number(amount / 1_000_000n);
  if (whole < 1_000) return "under 1K";
  if (whole < 5_000) return "1K–5K";
  if (whole < 20_000) return "5K–20K";
  if (whole < 80_000) return "20K–80K";
  return "80K+";
}

export function describeAmount(amount: bigint): string {
  return `${formatShiny(amount, { compact: true })} $SHINY`;
}
