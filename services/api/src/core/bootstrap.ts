/**
 * Idempotent boot seed: locations (from SEASON1_LOCATIONS), genesis emissions funding,
 * config_kv defaults (kill switches, season_start), mint waves, cosmetics catalog and
 * the first recruitment raffle. Safe to run on every boot.
 */
import { randomBytes } from "node:crypto";
import { SEASON1_LOCATIONS, commitHash, generateServerSeed } from "@trash-wars/economy";
import { SINKS, SUPPLY, toBaseUnits } from "@trash-wars/shared";
import { cosmeticItems, configKv, locations, mintEvents, raffles } from "@trash-wars/db";
import { count } from "./orm.js";
import type { AppContext } from "./context.js";
import { encryptSecret } from "./crypto.js";
import { ENC_PREFIX } from "./raffles.js";

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
];

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

  // Config defaults + season epoch.
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await db.insert(configKv).values({ key, value }).onConflictDoNothing({ target: configKv.key });
  }
  await db
    .insert(configKv)
    .values({ key: "season_start", value: new Date().toISOString() })
    .onConflictDoNothing({ target: configKv.key });

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
