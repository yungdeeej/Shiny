/**
 * Idempotent boot seed: locations (from SEASON1_LOCATIONS), genesis emissions funding,
 * config_kv defaults (kill switches, season_start), mint waves, cosmetics catalog,
 * the first recruitment raffle, and the v1.1 launch scope: 2M jackpot seed +
 * jackpot_winnable_at, tier_definitions (specs/01), Season Pass challenges/rewards
 * (specs/02). Safe to run on every boot.
 */
import { randomBytes } from "node:crypto";
import { SEASON1_LOCATIONS, commitHash, generateServerSeed } from "@trash-wars/economy";
import {
  JACKPOT,
  PASS,
  SINKS,
  SUPPLY,
  TIER_DEFINITIONS,
  TIER_ORDER,
  toBaseUnits,
} from "@trash-wars/shared";
import {
  cosmeticItems,
  configKv,
  jackpotEvents,
  locations,
  mintEvents,
  passChallenges,
  passRewards,
  raffles,
  tierDefinitions,
} from "@trash-wars/db";
import { count, sql } from "./orm.js";
import type { AppContext } from "./context.js";
import { encryptSecret } from "./crypto.js";
import { ENC_PREFIX } from "./raffles.js";
import { getKv } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIG_DEFAULTS: Record<string, unknown> = {
  withdrawals_paused: false,
  missions_paused: false,
  deposits_paused: false,
  bribe_bps: 300,
};

const COSMETICS: ReadonlyArray<
  readonly [
    slug: string,
    name: string,
    slot: "hat" | "coat" | "mask" | "companion" | "banner" | "nameplate",
    rarity: "common" | "rare" | "epic" | "legendary",
    priceShiny: number | null,
    priceSol: number | null,
    supplyCap: number | null,
    description: string,
  ]
> = [
  ["wet-felt-fedora", "Wet Felt Fedora", "hat", "common", 500, null, null, "Found behind the fish market. Still smells like ambition."],
  ["neon-heist-mask", "Neon Heist Mask", "mask", "rare", 2_000, null, null, "Glows just enough to get you caught in style."],
  ["tailored-trench", "Tailored Trench", "coat", "rare", 3_500, null, null, "Forty hidden pockets. Zero questions asked."],
  ["gold-tooth", "Gold Tooth", "nameplate", "epic", 8_000, null, null, "Flash it when you grin at the camera."],
  ["lil-pigeon", "Lil Pigeon", "companion", "epic", 12_000, null, null, "Carries messages. Eats evidence."],
  ["crown-of-shorefront", "Crown of Shorefront", "hat", "legendary", 50_000, null, 10, "There is only one king of the dumpsters. Ten of them, actually."],
  ["alley-cat-banner", "Alley Cat Banner", "banner", "common", 750, null, null, "Mark your turf in flickering sodium light."],
  ["smoke-break-banner", "Smoke Break Banner", "banner", "rare", 2_500, null, null, "For profiles that have seen some things."],
  ["velvet-nameplate", "Velvet Rope Nameplate", "nameplate", "common", 800, null, null, "Your name, but with bouncers."],
  ["shorefront-silk-scarf", "Shorefront Silk Scarf", "coat", "legendary", null, 0.5, 100, "Premium drop. Pure silk, pure flex — SOL only."],
  // v1.1 Season Pass exclusives (specs/02): unpurchasable — pass rewards only.
  ["heat-rookie-plate", "Heat: Rookie Plate", "nameplate", "rare", null, null, null, "Season Pass exclusive. You ran the streets in season one."],
  ["heat-capo-plate", "Heat: Capo Plate", "nameplate", "epic", null, null, null, "Season Pass exclusive. Half the ladder, all the swagger."],
  ["heat-kingmaker-plate", "Heat: Kingmaker Plate", "nameplate", "legendary", null, null, null, "Season Pass exclusive. Level 50. Nobody argues with the plate."],
];

/** specs/02: weekly challenge definitions, 3/week × 13 weeks, seeded idempotently. */
function seasonOneChallenges(): Array<{
  season: number;
  week: number;
  slug: string;
  description: string;
  kind: string;
  refSlug: string | null;
  target: number;
  xp: number;
}> {
  const spots = ["corner-store", "pawn-shop", "jewelry-district", "armored-truck", "first-national"];
  const names: Record<string, string> = {
    "corner-store": "Corner Store",
    "pawn-shop": "Pawn Shop",
    "jewelry-district": "Jewelry District",
    "armored-truck": "Armored Truck",
    "first-national": "First National",
  };
  const rows = [];
  for (let week = 0; week < 13; week++) {
    const spot = spots[week % spots.length]!;
    const survive = spots[(week + 2) % spots.length]!;
    rows.push({
      season: 1,
      week,
      slug: `s1-w${week}-jobs`,
      description: `Pull 5 jobs at ${names[spot]}`,
      kind: "missions_at_location",
      refSlug: spot,
      target: 5,
      xp: PASS.xp.weeklyChallenge,
    });
    rows.push({
      season: 1,
      week,
      slug: `s1-w${week}-survive`,
      description: `Survive ${names[survive]} twice`,
      kind: "survive_location",
      refSlug: survive,
      target: 2,
      xp: PASS.xp.weeklyChallenge,
    });
    rows.push(
      week % 3 === 2
        ? {
            season: 1,
            week,
            slug: `s1-w${week}-bail`,
            description: "Post bail twice — nobody rots in the tank on your watch",
            kind: "bail_outs",
            refSlug: null,
            target: 2,
            xp: PASS.xp.weeklyChallenge,
          }
        : week % 3 === 1
          ? {
              season: 1,
              week,
              slug: `s1-w${week}-raffle`,
              description: "Buy 5 raffle tickets",
              kind: "raffle_tickets",
              refSlug: null,
              target: 5,
              xp: PASS.xp.weeklyChallenge,
            }
          : {
              season: 1,
              week,
              slug: `s1-w${week}-wins`,
              description: "Win 3 jobs anywhere in Shorefront",
              kind: "wins_anywhere",
              refSlug: null,
              target: 3,
              xp: PASS.xp.weeklyChallenge,
            },
    );
  }
  return rows;
}

/**
 * specs/02 reward cadence: free track every 5 levels, premium every level.
 * Iron rule enforced by kind whitelist: cosmetics, vouchers, fragments,
 * nameplates — never $SHINY amounts, never stat effects.
 */
function seasonOneRewards(): Array<{
  season: number;
  level: number;
  track: "free" | "premium";
  kind: "cosmetic" | "insurance_voucher" | "raffle_fragments" | "nameplate";
  refSlug: string | null;
  amount: number | null;
}> {
  const rows: Array<{
    season: number;
    level: number;
    track: "free" | "premium";
    kind: "cosmetic" | "insurance_voucher" | "raffle_fragments" | "nameplate";
    refSlug: string | null;
    amount: number | null;
  }> = [];
  const plates: Record<number, string> = {
    10: "heat-rookie-plate",
    25: "heat-capo-plate",
    50: "heat-kingmaker-plate",
  };
  const voucherLevels = new Set([5, 15, 20, 30, 40]);
  for (let level = 1; level <= PASS.levels; level++) {
    if (plates[level]) {
      rows.push({ season: 1, level, track: "premium", kind: "nameplate", refSlug: plates[level]!, amount: null });
    } else if (voucherLevels.has(level)) {
      rows.push({ season: 1, level, track: "premium", kind: "insurance_voucher", refSlug: null, amount: 1 });
    } else {
      rows.push({
        season: 1,
        level,
        track: "premium",
        kind: "raffle_fragments",
        refSlug: null,
        amount: level % 2 === 0 ? 3 : 2,
      });
    }
    if (level % 5 === 0) {
      if (level === 25) {
        rows.push({ season: 1, level, track: "free", kind: "cosmetic", refSlug: "alley-cat-banner", amount: null });
      } else if (level === 50) {
        rows.push({ season: 1, level, track: "free", kind: "cosmetic", refSlug: "smoke-break-banner", amount: null });
      } else {
        rows.push({
          season: 1,
          level,
          track: "free",
          kind: "raffle_fragments",
          refSlug: null,
          amount: level % 4 === 0 ? 3 : 2,
        });
      }
    }
  }
  return rows;
}

export async function bootstrap(ctx: AppContext): Promise<void> {
  const { db, ledger, accounts } = ctx;

  // Genesis: fund the in-game emissions reserve from the on-chain mirror (sum stays 0).
  await ledger.postTransaction(
    [
      { accountId: accounts.emissions_reserve, delta: SUPPLY.emissionsReserve },
      { accountId: accounts.onchain_reserve_mirror, delta: -SUPPLY.emissionsReserve },
    ],
    { idempotencyKey: "genesis:emissions_reserve:v1", refType: "genesis", refId: "season-0" },
  );

  // Locations — insert only; never clobber admin-tuned configs.
  for (const loc of SEASON1_LOCATIONS) {
    await db
      .insert(locations)
      .values({ slug: loc.slug, name: loc.name, config: loc, enabled: loc.enabled })
      .onConflictDoNothing({ target: locations.slug });
  }
  // v1.1 backfill (additive, idempotent): databases seeded pre-v1.1 have a
  // the-mint config without the jackpotEligible flag — set ONLY that key,
  // never touching tuned odds/stakes (specs/03: true only for the-mint).
  await db.execute(
    sql`UPDATE "locations" SET "config" = "config" || '{"jackpotEligible": true}'::jsonb
        WHERE "slug" = 'the-mint' AND ("config" ->> 'jackpotEligible') IS NULL`,
  );

  // Config defaults + season epoch.
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await db.insert(configKv).values({ key, value }).onConflictDoNothing({ target: configKv.key });
  }
  await db
    .insert(configKv)
    .values({ key: "season_start", value: new Date().toISOString() })
    .onConflictDoNothing({ target: configKv.key });

  // v1.1 (specs/03): 2M jackpot seed from the marketing tranche mirror —
  // posts exactly once across reboots via the ledger idempotency key.
  const seeded = await ledger.postTransaction(
    [
      { accountId: accounts.jackpot_pool, delta: JACKPOT.seedAmount },
      { accountId: accounts.onchain_reserve_mirror, delta: -JACKPOT.seedAmount },
    ],
    { idempotencyKey: "jackpot-seed:s1", refType: "jackpot_seed", refId: "season-1" },
  );
  if (seeded.applied) {
    await db.insert(jackpotEvents).values({
      kind: "seed",
      amount: JACKPOT.seedAmount,
      poolAfter: await ledger.getBalance(accounts.jackpot_pool),
    });
  }

  // jackpot_winnable_at default: season_start + 56 game-days (admin-movable).
  const seasonStartIso = (await getKv<string>(db, "season_start")) ?? new Date().toISOString();
  const winnableAt = new Date(
    Date.parse(seasonStartIso) + ctx.clock.gameHoursToMs(JACKPOT.winnableGameDay * 24),
  ).toISOString();
  await db
    .insert(configKv)
    .values({ key: "jackpot_winnable_at", value: winnableAt })
    .onConflictDoNothing({ target: configKv.key });

  // v1.1 (specs/01): tier thresholds + perks from the shared contract.
  for (const tier of TIER_ORDER) {
    const def = TIER_DEFINITIONS[tier];
    await db
      .insert(tierDefinitions)
      .values({ tier, minBalance: def.minHeld, perks: { ...def.perks } })
      .onConflictDoNothing({ target: tierDefinitions.tier });
  }

  // Mint waves.
  const mintCount = await db.select({ n: count() }).from(mintEvents);
  if ((mintCount[0]?.n ?? 0) === 0) {
    const now = new Date();
    const closes = new Date(now.getTime() + 14 * DAY_MS);
    await db.insert(mintEvents).values([
      {
        faction: "raccoon",
        price: SINKS.mintRaccoon,
        supply: 500,
        remaining: 500,
        opensAt: now,
        closesAt: closes,
        state: "open",
      },
      {
        faction: "bloodhound",
        price: SINKS.mintBloodhound,
        supply: 50,
        remaining: 50,
        opensAt: now,
        closesAt: closes,
        state: "open",
      },
    ]);
  }

  // Cosmetics catalog.
  for (const [slug, name, slot, rarity, priceShiny, priceSol, supplyCap, description] of COSMETICS) {
    await db
      .insert(cosmeticItems)
      .values({
        slug,
        name,
        slot,
        rarity,
        priceShiny: priceShiny === null ? null : toBaseUnits(priceShiny),
        priceSol,
        supplyCap,
        season: 1,
        description,
      })
      .onConflictDoNothing({ target: cosmeticItems.slug });
  }

  // v1.1 (specs/02): Season Pass weekly challenges + reward track.
  for (const challenge of seasonOneChallenges()) {
    await db
      .insert(passChallenges)
      .values(challenge)
      .onConflictDoNothing({ target: passChallenges.slug });
  }
  for (const reward of seasonOneRewards()) {
    await db
      .insert(passRewards)
      .values(reward)
      .onConflictDoNothing({
        target: [passRewards.season, passRewards.level, passRewards.track],
      });
  }

  // First recruitment raffle (commit published, seed encrypted until the draw).
  const raffleCount = await db.select({ n: count() }).from(raffles);
  if ((raffleCount[0]?.n ?? 0) === 0) {
    const now = new Date();
    const serverSeed = generateServerSeed();
    await db.insert(raffles).values({
      type: "recruitment",
      title: "First Score Recruitment Raffle",
      prize: { type: "character", faction: "raccoon", winners: 3, note: "fresh recruit, level 1" },
      ticketPrice: SINKS.raffleTicket,
      maxTickets: 10_000,
      opensAt: now,
      drawsAt: new Date(now.getTime() + 7 * DAY_MS),
      serverSeedHash: commitHash(serverSeed),
      serverSeed: ENC_PREFIX + encryptSecret(serverSeed, ctx.env.serverSeedEncryptionKey),
      state: "open",
    });
  }

  ctx.log.info("bootstrap seed complete");
}

/** Test/ops helper: random 8-char memo codes for deposit attribution. */
export function newMemoCode(): string {
  return randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}
