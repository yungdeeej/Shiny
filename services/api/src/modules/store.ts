/** Store module: cosmetics catalog, SHINY-rail purchases (100% burn), equip system. */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { equipRequest, storeBuyRequest, type CosmeticItem } from "@trash-wars/shared";
import { characters, cosmeticItems, userCosmetics } from "@trash-wars/db";
import { and, eq, isNull, or, sql } from "../core/orm.js";
import { badRequest, conflict, insufficientFunds, notFound, notImplemented } from "../core/errors.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { requireTos } from "./session.js";

function itemToApi(i: typeof cosmeticItems.$inferSelect): CosmeticItem {
  return {
    slug: i.slug,
    name: i.name,
    slot: i.slot,
    rarity: i.rarity,
    priceShiny: i.priceShiny === null ? null : i.priceShiny.toString(),
    priceSol: i.priceSol,
    supplyCap: i.supplyCap,
    remaining: i.supplyCap === null ? null : i.supplyCap - i.sold,
    season: i.season,
    description: i.description,
  };
}

/** Recompute a character's equipped-cosmetics slug array (jsonb cache for rendering). */
async function syncCharacterCosmetics(
  ctx: FastifyInstance["ctx"],
  characterId: string,
): Promise<void> {
  const equipped = await ctx.db
    .select({ slug: userCosmetics.itemSlug })
    .from(userCosmetics)
    .where(eq(userCosmetics.equippedCharacterId, characterId));
  await ctx.db
    .update(characters)
    .set({ cosmetics: equipped.map((e) => e.slug) })
    .where(eq(characters.id, characterId));
}

export default async function storeModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get("/store/items", async () => {
    const rows = await ctx.db.select().from(cosmeticItems);
    return rows.map(itemToApi);
  });

  app.get("/store/inventory", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select({ uc: userCosmetics, item: cosmeticItems })
      .from(userCosmetics)
      .innerJoin(cosmeticItems, eq(cosmeticItems.slug, userCosmetics.itemSlug))
      .where(eq(userCosmetics.userId, user.id));
    return rows.map((r) => ({
      id: r.uc.id,
      item: itemToApi(r.item),
      equippedCharacterId: r.uc.equippedCharacterId,
    }));
  });

  app.post("/store/buy", async (request) => {
    const user = requireTos(request);
    const { itemSlug } = storeBuyRequest.parse(request.body);
    const rows = await ctx.db
      .select()
      .from(cosmeticItems)
      .where(eq(cosmeticItems.slug, itemSlug))
      .limit(1);
    const item = rows[0];
    if (!item) throw notFound("item not found");
    if (item.priceShiny === null) {
      throw notImplemented(
        "SOL-rail premium purchases are not available in beta — SHINY-priced items only",
      );
    }
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < item.priceShiny) throw insufficientFunds();

    // Atomic supply cap.
    const claimed = await ctx.db
      .update(cosmeticItems)
      .set({ sold: sql`${cosmeticItems.sold} + 1` })
      .where(
        and(
          eq(cosmeticItems.slug, itemSlug),
          or(isNull(cosmeticItems.supplyCap), sql`${cosmeticItems.sold} < ${cosmeticItems.supplyCap}`),
        ),
      )
      .returning();
    if (!claimed[0]) throw conflict("SOLD_OUT", "item is sold out");

    const purchaseId = randomUUID();
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -item.priceShiny },
        { accountId: ctx.accounts.burn_pool, delta: item.priceShiny },
      ],
      { idempotencyKey: `store:${purchaseId}`, refType: "cosmetic", refId: itemSlug },
    );
    const inserted = await ctx.db
      .insert(userCosmetics)
      .values({ id: purchaseId, userId: user.id, itemSlug })
      .returning();
    return { ok: true, userCosmeticId: inserted[0]!.id };
  });

  app.post("/store/equip", async (request) => {
    const user = requireTos(request);
    const body = equipRequest.parse(request.body);
    const rows = await ctx.db
      .select({ uc: userCosmetics, item: cosmeticItems })
      .from(userCosmetics)
      .innerJoin(cosmeticItems, eq(cosmeticItems.slug, userCosmetics.itemSlug))
      .where(eq(userCosmetics.id, body.userCosmeticId))
      .limit(1);
    const row = rows[0];
    if (!row || row.uc.userId !== user.id) throw notFound("cosmetic not found");

    const previous = row.uc.equippedCharacterId;

    if (body.characterId === null) {
      await ctx.db
        .update(userCosmetics)
        .set({ equippedCharacterId: null })
        .where(eq(userCosmetics.id, row.uc.id));
      if (previous) await syncCharacterCosmetics(ctx, previous);
      return { ok: true, equippedCharacterId: null };
    }

    const charRows = await ctx.db
      .select()
      .from(characters)
      .where(eq(characters.id, body.characterId))
      .limit(1);
    const char = charRows[0];
    if (!char || char.ownerUserId !== user.id) throw notFound("character not found");
    if (char.status === "dead") throw badRequest("CHARACTER_DEAD", "corpses don't accessorize");

    // Slot uniqueness: unequip anything of the same slot on this character first.
    const sameSlot = await ctx.db
      .select({ id: userCosmetics.id })
      .from(userCosmetics)
      .innerJoin(cosmeticItems, eq(cosmeticItems.slug, userCosmetics.itemSlug))
      .where(
        and(
          eq(userCosmetics.equippedCharacterId, char.id),
          eq(cosmeticItems.slot, row.item.slot),
        ),
      );
    for (const other of sameSlot) {
      await ctx.db
        .update(userCosmetics)
        .set({ equippedCharacterId: null })
        .where(eq(userCosmetics.id, other.id));
    }
    await ctx.db
      .update(userCosmetics)
      .set({ equippedCharacterId: char.id })
      .where(eq(userCosmetics.id, row.uc.id));

    await syncCharacterCosmetics(ctx, char.id);
    if (previous && previous !== char.id) await syncCharacterCosmetics(ctx, previous);
    return { ok: true, equippedCharacterId: char.id };
  });
}
