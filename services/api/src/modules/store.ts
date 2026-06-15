/** Store module: cosmetics catalog, SHINY-rail purchases (100% burn), equip system. */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  equipRequest,
  storeBuyRequest,
  solConfirmRequest,
  type CosmeticItem,
  type SolBuyResponse,
  type SolConfirmResponse,
} from "@trash-wars/shared";
import { characters, cosmeticItems, solPayments, userCosmetics, wallets } from "@trash-wars/db";
import { and, eq, isNull, or, sql } from "../core/orm.js";
import { badRequest, conflict, insufficientFunds, notFound, notImplemented } from "../core/errors.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import {
  buildSolPayment,
  getSolRail,
  priceLamports,
  readMemoRef,
  verifySolPayment,
} from "../core/sol-payments.js";
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

/** The user's primary wallet address — the payer the SOL rail binds against. */
async function primaryWallet(
  ctx: FastifyInstance["ctx"],
  userId: string,
): Promise<string | null> {
  const rows = await ctx.db.select().from(wallets).where(eq(wallets.userId, userId));
  const primary = rows.find((w) => w.isPrimary) ?? rows[0];
  return primary?.address ?? null;
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
      // SOL-rail cosmetic: build an unsigned-transfer intent (doc 11). When the
      // rail is unconfigured (beta, no REVENUE_WALLET) it stays a 501 stub so the
      // SHINY rail is untouched and existing beta store tests keep passing.
      if (item.priceSol === null) {
        // Neither SHINY- nor SOL-priced → not purchasable (e.g. pass exclusives).
        throw badRequest("NOT_PURCHASABLE", "this item is not for sale");
      }
      const rail = getSolRail();
      if (!rail.config.enabled || !rail.config.revenueWallet) {
        throw notImplemented(
          "SOL-rail premium purchases are not available in beta — SHINY-priced items only",
        );
      }
      const payer = await primaryWallet(ctx, user.id);
      if (!payer) throw badRequest("NO_WALLET", "link a primary wallet before SOL purchases");
      const price = await priceLamports(ctx.db, "cosmetic", itemSlug);
      const built = await buildSolPayment({
        payer,
        product: "cosmetic",
        ref: price.ref,
        lamports: price.lamports,
        revenueWallet: rail.config.revenueWallet,
        rpc: rail.rpc,
      });
      const response: SolBuyResponse = {
        product: "cosmetic",
        ref: price.ref,
        priceSol: price.priceSol,
        lamports: price.lamports,
        revenueWallet: rail.config.revenueWallet,
        reference: built.reference,
        memo: built.memo,
        serializedTx: built.serializedTx,
        expiresAt: built.expiresAt,
      };
      return response;
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

  app.post("/store/confirm", async (request) => {
    const user = requireTos(request);
    const { txSig, reference } = solConfirmRequest.parse(request.body);
    const rail = getSolRail();
    if (!rail.config.enabled || !rail.config.revenueWallet) {
      throw notImplemented("SOL rail not configured in beta");
    }

    // Fast idempotent replay: a signature already granted returns without
    // re-verifying or re-granting (the unique tx_sig is the true arbiter below).
    const seen = await ctx.db
      .select()
      .from(solPayments)
      .where(eq(solPayments.txSig, txSig))
      .limit(1);
    if (seen[0]) {
      const response: SolConfirmResponse = {
        granted: true,
        product: "cosmetic",
        ref: seen[0].ref,
        txSig,
        alreadyGranted: true,
      };
      return response;
    }

    const payer = await primaryWallet(ctx, user.id);
    if (!payer) throw badRequest("NO_WALLET", "link a primary wallet before SOL purchases");

    // Re-derive the cosmetic slug from the on-chain memo, then re-price it
    // server-side so the verified lamports bind to the real catalog price — never
    // to anything the client supplied.
    const memoRef = await readMemoRef(rail.rpc, txSig);
    if (!memoRef || memoRef.product !== "cosmetic") {
      throw badRequest("PAYMENT_UNVERIFIED", "not a cosmetic SOL payment");
    }
    if (memoRef.reference !== reference) {
      throw badRequest("PAYMENT_UNVERIFIED", "reference mismatch");
    }
    const price = await priceLamports(ctx.db, "cosmetic", memoRef.ref);

    const result = await verifySolPayment({
      txSig,
      reference,
      expectedPayer: payer,
      expectedLamports: price.lamports,
      revenueWallet: rail.config.revenueWallet,
      rpc: rail.rpc,
    });
    if (!result.ok) {
      throw badRequest("PAYMENT_UNVERIFIED", `SOL payment not verified: ${result.reason}`);
    }

    // Record the receipt idempotently. The unique tx_sig is the grant arbiter: if
    // a concurrent confirm already inserted it, we do NOT double-grant.
    const recorded = await ctx.db
      .insert(solPayments)
      .values({
        txSig,
        userId: user.id,
        product: "cosmetic",
        ref: price.ref,
        reference,
        lamports: BigInt(price.lamports),
      })
      .onConflictDoNothing({ target: solPayments.txSig })
      .returning();
    if (!recorded[0]) {
      const response: SolConfirmResponse = {
        granted: true,
        product: "cosmetic",
        ref: price.ref,
        txSig,
        alreadyGranted: true,
      };
      return response;
    }

    // Atomic supply cap, then grant the cosmetic.
    const claimed = await ctx.db
      .update(cosmeticItems)
      .set({ sold: sql`${cosmeticItems.sold} + 1` })
      .where(
        and(
          eq(cosmeticItems.slug, price.ref),
          or(isNull(cosmeticItems.supplyCap), sql`${cosmeticItems.sold} < ${cosmeticItems.supplyCap}`),
        ),
      )
      .returning();
    if (!claimed[0]) throw conflict("SOLD_OUT", "item is sold out");

    await ctx.db.insert(userCosmetics).values({ userId: user.id, itemSlug: price.ref });

    const response: SolConfirmResponse = {
      granted: true,
      product: "cosmetic",
      ref: price.ref,
      txSig,
      alreadyGranted: false,
    };
    return response;
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
