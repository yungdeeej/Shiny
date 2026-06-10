/** Marketplace: P2P listings for characters and cosmetics. 10% fee = 5% burn / 5% treasury. */
import type { FastifyInstance } from "fastify";
import { applyBps, marketListRequest, type Listing } from "@trash-wars/shared";
import { characters, cosmeticItems, listings, userCosmetics, users } from "@trash-wars/db";
import { and, desc, eq, inArray } from "../core/orm.js";
import { badRequest, conflict, insufficientFunds, notFound } from "../core/errors.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { characterToApi } from "../core/characters.js";
import { requireTos } from "./session.js";

const FEE_BURN_BPS = 500;
const FEE_TREASURY_BPS = 500;

export default async function marketModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post("/market/list", async (request) => {
    const user = requireTos(request);
    const body = marketListRequest.parse(request.body);
    const price = BigInt(body.price);
    if (price <= 0n) throw badRequest("BAD_PRICE", "price must be positive");

    if (body.kind === "character") {
      const rows = await ctx.db
        .select()
        .from(characters)
        .where(eq(characters.id, body.refId))
        .limit(1);
      const char = rows[0];
      if (!char || char.ownerUserId !== user.id) throw notFound("character not found");
      if (char.status !== "idle") throw conflict("CHARACTER_BUSY", `character is ${char.status}`);
      if (!char.inGame) throw badRequest("NOT_IN_GAME", "character must be staked in-game");
      await ctx.db
        .update(characters)
        .set({ status: "listed", stationedAt: null })
        .where(eq(characters.id, char.id));
    } else {
      const rows = await ctx.db
        .select()
        .from(userCosmetics)
        .where(eq(userCosmetics.id, body.refId))
        .limit(1);
      const uc = rows[0];
      if (!uc || uc.userId !== user.id) throw notFound("cosmetic not found");
      if (uc.equippedCharacterId) throw conflict("EQUIPPED", "unequip the cosmetic first");
      const existing = await ctx.db
        .select()
        .from(listings)
        .where(and(eq(listings.refId, body.refId), eq(listings.state, "active")))
        .limit(1);
      if (existing[0]) throw conflict("ALREADY_LISTED", "cosmetic is already listed");
    }

    const inserted = await ctx.db
      .insert(listings)
      .values({ sellerId: user.id, kind: body.kind, refId: body.refId, price })
      .returning();
    return { ok: true, listingId: inserted[0]!.id };
  });

  app.post<{ Params: { id: string } }>("/market/delist/:id", async (request) => {
    const user = requireTos(request);
    const updated = await ctx.db
      .update(listings)
      .set({ state: "delisted" })
      .where(
        and(
          eq(listings.id, request.params.id),
          eq(listings.sellerId, user.id),
          eq(listings.state, "active"),
        ),
      )
      .returning();
    const listing = updated[0];
    if (!listing) throw notFound("active listing not found");
    if (listing.kind === "character") {
      await ctx.db
        .update(characters)
        .set({ status: "idle" })
        .where(and(eq(characters.id, listing.refId), eq(characters.status, "listed")));
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/market/buy/:id", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select()
      .from(listings)
      .where(eq(listings.id, request.params.id))
      .limit(1);
    const preview = rows[0];
    if (!preview) throw notFound("listing not found");
    if (preview.sellerId === user.id) throw badRequest("OWN_LISTING", "cannot buy your own listing");

    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < preview.price) throw insufficientFunds();

    // Atomic claim — the arbiter under concurrent purchases: exactly one buyer wins.
    const claimed = await ctx.db
      .update(listings)
      .set({ state: "sold", buyerId: user.id, soldAt: new Date() })
      .where(and(eq(listings.id, preview.id), eq(listings.state, "active")))
      .returning();
    const listing = claimed[0];
    if (!listing) throw conflict("NOT_AVAILABLE", "listing was just sold or delisted");

    try {
      const price = listing.price;
      const burn = applyBps(price, FEE_BURN_BPS);
      const treasury = applyBps(price, FEE_TREASURY_BPS);
      const sellerCut = price - burn - treasury;
      const buyerAccount = await getUserAccount(ctx.ledger, user.id);
      const sellerAccount = await getUserAccount(ctx.ledger, listing.sellerId);
      await ctx.ledger.postTransaction(
        [
          { accountId: buyerAccount, delta: -price },
          { accountId: sellerAccount, delta: sellerCut },
          { accountId: ctx.accounts.burn_pool, delta: burn },
          { accountId: ctx.accounts.treasury, delta: treasury },
        ],
        { idempotencyKey: `market:${listing.id}`, refType: "market_sale", refId: listing.id },
      );

      if (listing.kind === "character") {
        await ctx.db
          .update(characters)
          .set({ ownerUserId: user.id, status: "idle", stationedAt: null })
          .where(eq(characters.id, listing.refId));
      } else {
        await ctx.db
          .update(userCosmetics)
          .set({ userId: user.id, equippedCharacterId: null })
          .where(eq(userCosmetics.id, listing.refId));
      }
      return { ok: true, price: listing.price.toString() };
    } catch (err) {
      // Roll the claim back so the listing stays purchasable.
      await ctx.db
        .update(listings)
        .set({ state: "active", buyerId: null, soldAt: null })
        .where(eq(listings.id, listing.id));
      throw err;
    }
  });

  app.get("/market/listings", async () => {
    const active = await ctx.db
      .select({ listing: listings, seller: users })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.sellerId))
      .where(eq(listings.state, "active"))
      .orderBy(desc(listings.createdAt))
      .limit(100);

    const result: Listing[] = [];
    for (const row of active) {
      let character = null;
      let cosmeticSlug: string | null = null;
      if (row.listing.kind === "character") {
        const chars = await ctx.db
          .select()
          .from(characters)
          .where(eq(characters.id, row.listing.refId))
          .limit(1);
        character = chars[0] ? characterToApi(chars[0]) : null;
      } else {
        const ucs = await ctx.db
          .select({ slug: userCosmetics.itemSlug })
          .from(userCosmetics)
          .where(eq(userCosmetics.id, row.listing.refId))
          .limit(1);
        cosmeticSlug = ucs[0]?.slug ?? null;
      }
      result.push({
        id: row.listing.id,
        kind: row.listing.kind,
        sellerHandle: row.seller.handle,
        refId: row.listing.refId,
        price: row.listing.price.toString(),
        state: row.listing.state,
        character,
        cosmeticSlug,
        createdAt: row.listing.createdAt.toISOString(),
      });
    }

    // Price history: last 20 sales per kind.
    const history: Record<string, { price: string; soldAt: string }[]> = {};
    for (const kind of ["character", "cosmetic"] as const) {
      const sold = await ctx.db
        .select()
        .from(listings)
        .where(and(eq(listings.kind, kind), eq(listings.state, "sold")))
        .orderBy(desc(listings.soldAt))
        .limit(20);
      history[kind] = sold.map((s) => ({
        price: s.price.toString(),
        soldAt: s.soldAt ? s.soldAt.toISOString() : s.createdAt.toISOString(),
      }));
    }

    return { listings: result, history };
  });
}
