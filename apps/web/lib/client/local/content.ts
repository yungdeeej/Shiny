import { locationConfig, toBaseUnits, type CosmeticItem, type LocationConfig } from "@trash-wars/shared";

const u = (whole: number): string => toBaseUnits(whole).toString();

/**
 * Local policy knobs that the shared packages don't define (yet).
 * GAP: bribe price bps is "configured" server-side per doc 08 but absent from
 * shared POLICY — we pin the beta value here.
 */
export const LOCAL_POLICY = {
  bribePriceBps: 300, // 3% of stake, 75% burn / 25% to patrolling hounds
  faucetAmount: toBaseUnits(100_000),
  faucetCooldownGameHours: 24,
  starterBalance: toBaseUnits(100_000),
  loginFragmentsPerTicket: 5,
} as const;

/* ── v1.1 demo compressions (labeled "beta time" in the UI) ───────── */

export const DEMO_V11 = {
  /** Street Cred downgrade grace: 24h on mainnet, compressed to 2 real minutes. */
  credGraceRealMs: 2 * 60_000,
  /** Jackpot winnable 15 real minutes after first login (wk8 compressed). */
  jackpotWinnableAfterRealMs: 15 * 60_000,
  /** Bot losses pump the public pool every bucket (a few hundred SHINY each). */
  jackpotBotBucketMs: 20_000,
  /** Default simulated wallet holding: 10,000 SHINY → Alley. */
  defaultHolding: toBaseUnits(10_000),
  /** /cred simulator presets (whole SHINY). */
  holdingPresets: [10_000, 50_000, 250_000, 1_000_000, 5_000_000],
  /** Limited mint waves cycle every 20 real minutes (early access = tier hours). */
  mintWaveCycleRealMs: 20 * 60_000,
} as const;

/** Kingpin-only location (specs/01 — "The Penthouse Job", best EV curve). */
export const PENTHOUSE_LOCATION: LocationConfig = locationConfig.parse({
  slug: "the-penthouse",
  name: "The Penthouse Job",
  tagline: "Top floor of the city. Kingpins only — the doorman knows.",
  durationHours: 16,
  minStake: u(800),
  maxStake: u(1_250),
  table: [
    { outcome: "win", probabilityBps: 2_400, multiplierBps: 36_000 },
    { outcome: "jackpot", probabilityBps: 250, multiplierBps: 90_000 },
    { outcome: "nothing", probabilityBps: 1_950 },
    { outcome: "arrest", probabilityBps: 2_400 },
    { outcome: "confiscation", probabilityBps: 2_100 },
    { outcome: "rekt_character", probabilityBps: 900 },
  ],
  requiresCharacter: true,
  freeTierAllowed: false,
  rektCapable: true,
  insuranceBps: 2_600,
  idleRatePerHour: u(15),
  patrolWeightCap: 10,
  capArrestShiftBps: 900,
  capConfShiftBps: 800,
  enabled: true,
});

/* ── Season Pass content (specs/02) ───────────────────────────────── */

export interface PassRewardDef {
  id: string;
  level: number;
  track: "free" | "premium";
  kind: "cosmetic" | "insurance_voucher" | "raffle_fragments" | "nameplate";
  refSlug: string | null;
  amount: number | null;
}

/** Pass-exclusive nameplates at premium 10/25/50 (never sold, never stats). */
export const PASS_NAMEPLATES: Record<number, string> = {
  10: "nameplate-heat-bronze",
  25: "nameplate-heat-silver",
  50: "nameplate-heat-gold",
};

const FREE_TRACK: Array<[number, PassRewardDef["kind"], string | null, number | null]> = [
  [5, "raffle_fragments", null, 2],
  [10, "cosmetic", "hat-beanie", null],
  [15, "insurance_voucher", null, 1],
  [20, "raffle_fragments", null, 3],
  [25, "cosmetic", "banner-skyline", null],
  [30, "insurance_voucher", null, 1],
  [35, "raffle_fragments", null, 3],
  [40, "cosmetic", "coat-trench", null],
  [45, "raffle_fragments", null, 2],
  [50, "cosmetic", "hat-fedora", null],
];

const PREMIUM_COSMETIC_CYCLE = [
  "hat-fedora", "mask-visor", "coat-trench", "companion-pigeon", "hat-beanie", "banner-skyline", "hat-crown",
];
const PREMIUM_VOUCHER_LEVELS = new Set([5, 15, 20, 30, 40]);

/**
 * Reward ladder: free every 5 levels, premium every level. Iron rule (doc 13
 * §4): cosmetics / vouchers / fragments / nameplates only — NEVER $SHINY
 * amounts, NEVER stat effects.
 */
export const PASS_REWARDS: PassRewardDef[] = (() => {
  const out: PassRewardDef[] = [];
  for (const [level, kind, refSlug, amount] of FREE_TRACK) {
    out.push({ id: `s1-free-${level}`, level, track: "free", kind, refSlug, amount });
  }
  for (let level = 1; level <= 50; level++) {
    let kind: PassRewardDef["kind"];
    let refSlug: string | null = null;
    let amount: number | null = null;
    if (PASS_NAMEPLATES[level]) {
      kind = "nameplate";
      refSlug = PASS_NAMEPLATES[level] ?? null;
    } else if (PREMIUM_VOUCHER_LEVELS.has(level)) {
      kind = "insurance_voucher";
      amount = 1;
    } else if (level % 7 === 0) {
      kind = "cosmetic";
      refSlug = PREMIUM_COSMETIC_CYCLE[(level / 7 - 1) % PREMIUM_COSMETIC_CYCLE.length] ?? "hat-fedora";
    } else {
      kind = "raffle_fragments";
      amount = level % 2 === 0 ? 3 : 2;
    }
    out.push({ id: `s1-prem-${level}`, level, track: "premium", kind, refSlug, amount });
  }
  return out;
})();

export interface PassChallengeDef {
  slug: string;
  description: string;
  kind: "resolve_at" | "survive_rekt" | "raffle_tickets" | "wins" | "bails";
  /** location slug for resolve_at */
  ref?: string;
  target: number;
}

/** Weekly rotation pool — 3 picked per demo game-week. */
export const PASS_CHALLENGE_POOL: PassChallengeDef[] = [
  { slug: "pawn-jobs-3", description: "Pull 3 jobs at the Pawn Shop", kind: "resolve_at", ref: "pawn-shop", target: 3 },
  { slug: "survive-rekt-2", description: "Survive a rekt-capable location twice", kind: "survive_rekt", target: 2 },
  { slug: "raffle-5", description: "Buy 5 raffle tickets", kind: "raffle_tickets", target: 5 },
  { slug: "corner-jobs-5", description: "Pull 5 jobs at the Corner Store", kind: "resolve_at", ref: "corner-store", target: 5 },
  { slug: "clean-getaways-3", description: "Walk away clean 3 times", kind: "wins", target: 3 },
  { slug: "bail-out-1", description: "Bail a crew member out of the tank", kind: "bails", target: 1 },
];

/** Season-1 cosmetics catalogue (beta). Slugs double as avatar layer keys. */
export const STORE_ITEMS: CosmeticItem[] = [
  {
    slug: "hat-fedora",
    name: "Rainline Fedora",
    slot: "hat",
    rarity: "common",
    priceShiny: u(2_000),
    priceSol: null,
    supplyCap: null,
    remaining: null,
    season: 1,
    description: "Keeps the rain out of your eyes and the cameras off your face.",
  },
  {
    slug: "hat-beanie",
    name: "Dock Worker Beanie",
    slot: "hat",
    rarity: "common",
    priceShiny: u(1_200),
    priceSol: null,
    supplyCap: null,
    remaining: null,
    season: 1,
    description: "Standard issue for anyone who's ever cased a warehouse.",
  },
  {
    slug: "hat-crown",
    name: "Dumpster Crown",
    slot: "hat",
    rarity: "legendary",
    priceShiny: u(50_000),
    priceSol: null,
    supplyCap: 25,
    remaining: 11,
    season: 1,
    description: "Somebody threw out a kingdom. You wear what's left of it.",
  },
  {
    slug: "mask-visor",
    name: "Neon Visor",
    slot: "mask",
    rarity: "epic",
    priceShiny: u(15_000),
    priceSol: null,
    supplyCap: 200,
    remaining: 84,
    season: 1,
    description: "See in the dark. Be seen in the dark. Tradeoffs.",
  },
  {
    slug: "coat-trench",
    name: "Shorefront Trench",
    slot: "coat",
    rarity: "rare",
    priceShiny: u(6_000),
    priceSol: null,
    supplyCap: null,
    remaining: null,
    season: 1,
    description: "Four inside pockets. None of them are for your own stuff.",
  },
  {
    slug: "companion-pigeon",
    name: "Lookout Pigeon",
    slot: "companion",
    rarity: "rare",
    priceShiny: u(8_000),
    priceSol: null,
    supplyCap: null,
    remaining: null,
    season: 1,
    description: "Coos twice if the heat's coming. Usually.",
  },
  {
    slug: "banner-skyline",
    name: "Skyline Banner",
    slot: "banner",
    rarity: "common",
    priceShiny: u(1_500),
    priceSol: null,
    supplyCap: null,
    remaining: null,
    season: 1,
    description: "Your profile, but make it noir.",
  },
  {
    slug: "nameplate-gilded",
    name: "Gilded Nameplate",
    slot: "nameplate",
    rarity: "epic",
    priceShiny: null,
    priceSol: 0.25,
    supplyCap: 500,
    remaining: 500,
    season: 1,
    description: "Premium rail. Arrives with mainnet — SOL checkout coming soon.",
  },
];

/** Noir bot roster names (40). Mix of raccoons and bloodhounds. */
export const BOT_NAMES: ReadonlyArray<{ name: string; faction: "raccoon" | "bloodhound" }> = [
  { name: "Velvet Knuckles", faction: "raccoon" },
  { name: "Two-Step Tibbs", faction: "raccoon" },
  { name: "Marlowe the Damp", faction: "raccoon" },
  { name: "Sister Static", faction: "raccoon" },
  { name: "Greasy Calhoun", faction: "raccoon" },
  { name: "The Pale Bandit", faction: "raccoon" },
  { name: "Nickels", faction: "raccoon" },
  { name: "Madame Forklift", faction: "raccoon" },
  { name: "Sad Eyes Sal", faction: "raccoon" },
  { name: "Brick Tooth", faction: "raccoon" },
  { name: "Lullaby Lou", faction: "raccoon" },
  { name: "The Mayor of Nothing", faction: "raccoon" },
  { name: "Quiet Jenny", faction: "raccoon" },
  { name: "Half-Pint Hugo", faction: "raccoon" },
  { name: "Cufflinks", faction: "raccoon" },
  { name: "Riverside Rosa", faction: "raccoon" },
  { name: "Smokestack Eddie", faction: "raccoon" },
  { name: "The Insurance Salesman", faction: "raccoon" },
  { name: "Penny Dreadful", faction: "raccoon" },
  { name: "Glasshouse Gus", faction: "raccoon" },
  { name: "Mittens DeLuca", faction: "raccoon" },
  { name: "Foggy Pete", faction: "raccoon" },
  { name: "The Archivist", faction: "raccoon" },
  { name: "Switchblade Sue", faction: "raccoon" },
  { name: "Old Turnstile", faction: "raccoon" },
  { name: "Caviar Carl", faction: "raccoon" },
  { name: "Wet Sock Willy", faction: "raccoon" },
  { name: "Duchess of Dumpsters", faction: "raccoon" },
  { name: "Three-Finger Fitz", faction: "raccoon" },
  { name: "Neon Nadia", faction: "raccoon" },
  { name: "Officer Rex", faction: "bloodhound" },
  { name: "Sgt. Slobber", faction: "bloodhound" },
  { name: "K9-Magnus", faction: "bloodhound" },
  { name: "Detective Drool", faction: "bloodhound" },
  { name: "Warrant", faction: "bloodhound" },
  { name: "Captain Bayou", faction: "bloodhound" },
  { name: "The Bloodhound General", faction: "bloodhound" },
  { name: "Patrolman Pudge", faction: "bloodhound" },
  { name: "Inspector Howl", faction: "bloodhound" },
  { name: "Deputy Dewlap", faction: "bloodhound" },
];

export const EMPTY_LINES = {
  feed: "Nothing but rain out here.",
  jail: "Nobody's in the tank. Keep it that way.",
  missions: "No jobs running. The city won't rob itself.",
  market: "Shelves are bare. Somebody clean this place out already?",
  den: "An empty den. Even the rats moved somewhere nicer.",
  patrols: "No hounds on the street tonight.",
  history: "No paper trail. The way you like it.",
} as const;
