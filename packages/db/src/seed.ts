/**
 * Idempotent seed: migrate, system accounts, genesis emissions funding, locations
 * (from @trash-wars/economy if available), starter mint event, cosmetics, a recruitment
 * raffle, and config_kv kill-switch defaults. Safe to run repeatedly.
 */
import { createHash, randomBytes } from "node:crypto";
import { count } from "drizzle-orm";
import { SINKS, SUPPLY, toBaseUnits } from "@trash-wars/shared";
import { closeDb, createDb, migrateDb, type Db } from "./client.js";
import { LedgerService } from "./ledger.js";
import { cosmeticItems, configKv, locations, mintEvents, raffles } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedLocations(db: Db): Promise<void> {
  // packages/economy is built in parallel and may not exist yet — import lazily via a
  // non-literal specifier so TS doesn't resolve it, and skip gracefully if unavailable.
  const specifier = ["@trash-wars", "economy"].join("/");
  let season1: unknown;
  try {
    const economy = (await import(specifier)) as Record<string, unknown>;
    season1 = economy.SEASON1_LOCATIONS;
  } catch {
    console.warn("[seed] @trash-wars/economy not available — skipping location seed");
    return;
  }
  if (!Array.isArray(season1)) {
    console.warn("[seed] @trash-wars/economy has no SEASON1_LOCATIONS array — skipping");
    return;
  }
  for (const loc of season1 as Array<Record<string, unknown>>) {
    const slug = String(loc.slug);
    const row = {
      slug,
      name: String(loc.name ?? slug),
      config: loc,
      enabled: loc.enabled !== false,
    };
    await db
      .insert(locations)
      .values(row)
      .onConflictDoUpdate({ target: locations.slug, set: row });
  }
  console.log(`[seed] upserted ${season1.length} locations`);
}

async function seedGenesis(ledger: LedgerService): Promise<void> {
  const sys = await ledger.ensureSystemAccounts();
  // Contra convention: `onchain_reserve_mirror` mirrors tokens that exist on-chain outside
  // the game ledger. Funding the in-game emissions_reserve is modeled double-entry as
  //   emissions_reserve +700M / onchain_reserve_mirror -700M
  // so the ledger always sums to zero and the mirror's (negative) balance states exactly
  // how much $SHINY the game ledger represents from the on-chain reserve.
  const result = await ledger.postTransaction(
    [
      { accountId: sys.emissions_reserve, delta: SUPPLY.emissionsReserve },
      { accountId: sys.onchain_reserve_mirror, delta: -SUPPLY.emissionsReserve },
    ],
    { idempotencyKey: "genesis:emissions_reserve:v1", refType: "genesis", refId: "season-0" },
  );
  console.log(
    `[seed] genesis emissions funding ${result.applied ? "applied" : "already present"} (txn ${result.txnId})`,
  );
}

async function seedMintEvent(db: Db): Promise<void> {
  const existing = await db.select({ n: count() }).from(mintEvents);
  if ((existing[0]?.n ?? 0) > 0) return;
  const now = new Date();
  await db.insert(mintEvents).values({
    faction: "raccoon",
    price: SINKS.mintRaccoon,
    supply: 500,
    remaining: 500,
    opensAt: now,
    closesAt: new Date(now.getTime() + 14 * DAY_MS),
    state: "open",
  });
  console.log("[seed] created raccoon mint wave (500 supply, open 14d)");
}

const COSMETICS = [
  ["trash-lid-helm", "Trash Lid Helm", "hat", "common", 500, "A dented dumpster lid, worn with pride."],
  ["bottlecap-crown", "Bottlecap Crown", "hat", "legendary", 50_000, "Forged from ten thousand shiny caps."],
  ["midnight-trench", "Midnight Trench", "coat", "rare", 4_000, "For raccoons who deal in secrets."],
  ["patchwork-parka", "Patchwork Parka", "coat", "common", 750, "Sewn from forty-one lost gloves."],
  ["alley-bandit-mask", "Alley Bandit Mask", "mask", "common", 600, "The classic. Never goes out of style."],
  ["chrome-muzzle", "Chrome Muzzle", "mask", "epic", 12_000, "Bloodhound-grade intimidation hardware."],
  ["sewer-rat-pal", "Sewer Rat Pal", "companion", "rare", 5_000, "Smells trouble three blocks away."],
  ["neon-dumpster-banner", "Neon Dumpster Banner", "banner", "epic", 9_000, "Announce your turf in buzzing pink."],
] as const;

async function seedCosmetics(db: Db): Promise<void> {
  for (const [slug, name, slot, rarity, priceWhole, description] of COSMETICS) {
    await db
      .insert(cosmeticItems)
      .values({
        slug,
        name,
        slot,
        rarity,
        priceShiny: toBaseUnits(priceWhole),
        season: 1,
        description,
      })
      .onConflictDoNothing({ target: cosmeticItems.slug });
  }
  console.log(`[seed] ensured ${COSMETICS.length} cosmetic items`);
}

async function seedRaffle(db: Db): Promise<void> {
  const existing = await db.select({ n: count() }).from(raffles);
  if ((existing[0]?.n ?? 0) > 0) return;
  const now = new Date();
  const serverSeed = randomBytes(32).toString("hex");
  await db.insert(raffles).values({
    type: "recruitment",
    title: "First Score Recruitment Raffle",
    prize: { type: "character", faction: "raccoon", note: "fresh recruit, level 1" },
    ticketPrice: SINKS.raffleTicket,
    maxTickets: 10_000,
    opensAt: now,
    drawsAt: new Date(now.getTime() + 7 * DAY_MS),
    serverSeedHash: createHash("sha256").update(serverSeed).digest("hex"),
    // serverSeed stays null until the draw — only the commitment hash is published.
    state: "open",
  });
  console.log("[seed] created recruitment raffle (draws in 7d)");
}

const CONFIG_DEFAULTS: Record<string, unknown> = {
  withdrawals_paused: false,
  missions_paused: false,
  deposits_paused: false,
};

async function seedConfig(db: Db): Promise<void> {
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await db.insert(configKv).values({ key, value }).onConflictDoNothing({ target: configKv.key });
  }
  console.log("[seed] ensured config_kv defaults");
}

export async function seed(db: Db): Promise<void> {
  await migrateDb(db);
  const ledger = new LedgerService(db);
  await seedGenesis(ledger);
  await seedLocations(db);
  await seedMintEvent(db);
  await seedCosmetics(db);
  await seedRaffle(db);
  await seedConfig(db);
}

const db = createDb();
await seed(db);
console.log("[seed] done");
await closeDb(db);
