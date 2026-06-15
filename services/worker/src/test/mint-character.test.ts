/**
 * Mint fulfillment with a fake provider + a tiny manifest fixture: writes
 * nft_mint + banded stats, marks fulfilled, idempotent on re-run; provider
 * failure → failed_retry (and never refunds).
 */
import { afterEach, describe, expect, it } from "vitest";
import { characters, mintEvents, mintOrders, users } from "@trash-wars/db";
import type { AppContext } from "@trash-wars/api/core";
import { eq } from "../orm.js";
import { fulfillMintOrder } from "../jobs/mint-character.js";
import type { Manifest } from "../chain/manifest.js";
import { buildWorkerTestContext, FakeChainProvider } from "./helpers.js";

let ctx: AppContext;
afterEach(async () => {
  if (ctx) await ctx.close();
});

const MANIFEST: Manifest = {
  collection: { name: "Trash Wars S1", address: null },
  assets: [
    {
      index: 0,
      faction: "raccoon",
      rarity: "rare",
      traits: { hat: "fedora" },
      statBands: { stealth: [5, 5], muscle: [2, 2], luck: [3, 3], reputation: [0, 0] },
      metadataUri: "https://art/raccoon-0.json",
      imageUri: "https://art/raccoon-0.png",
    },
  ],
};

async function seedOrder(
  c: AppContext,
  faction: "raccoon" | "bloodhound" = "raccoon",
): Promise<{ orderId: string; characterId: string }> {
  const u = await c.db.insert(users).values({ handle: `m_${Math.random()}`, isGuest: true }).returning();
  const userId = u[0]!.id;
  const ev = await c.db
    .insert(mintEvents)
    .values({
      faction,
      price: 1000n,
      supply: 10,
      remaining: 9,
      opensAt: new Date(Date.now() - 1000),
      closesAt: new Date(Date.now() + 1_000_000),
      state: "open",
    })
    .returning();
  const ch = await c.db
    .insert(characters)
    .values({
      ownerUserId: userId,
      name: "Test Coon",
      faction,
      level: 1,
      stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
      dna: "abc123",
      status: "idle",
      inGame: true,
    })
    .returning();
  const orderId = crypto.randomUUID();
  await c.db.insert(mintOrders).values({
    id: orderId,
    userId,
    eventId: ev[0]!.id,
    state: "pending",
    characterId: ch[0]!.id,
    idempotencyKey: `mint:${orderId}`,
  });
  return { orderId, characterId: ch[0]!.id };
}

describe("mint fulfillment", () => {
  it("mints on-chain, writes nft_mint + banded stats, marks fulfilled", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    const { orderId, characterId } = await seedOrder(ctx);

    const res = await fulfillMintOrder(ctx, orderId, { manifest: MANIFEST });
    expect(res.state).toBe("fulfilled");
    expect(res.assetId).toMatch(/^FAKE-ASSET/);
    expect(fake.countOf("mintCharacter")).toBe(1);

    const ch = (await ctx.db.select().from(characters).where(eq(characters.id, characterId)))[0]!;
    expect(ch.nftMint).toBe(res.assetId);
    // Banded stats from the [n,n] fixture are deterministic.
    expect(ch.stats).toEqual({ stealth: 5, muscle: 2, luck: 3, reputation: 0 });

    const order = (await ctx.db.select().from(mintOrders).where(eq(mintOrders.id, orderId)))[0]!;
    expect(order.state).toBe("fulfilled");

    // The mint used the manifest metadata uri.
    const call = fake.calls.find((c) => c.op === "mintCharacter")!.args as { uri: string };
    expect(call.uri).toBe("https://art/raccoon-0.json");
  });

  it("is idempotent on re-run (no second on-chain mint)", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    const { orderId } = await seedOrder(ctx);
    await fulfillMintOrder(ctx, orderId, { manifest: MANIFEST });
    const again = await fulfillMintOrder(ctx, orderId, { manifest: MANIFEST });
    expect(again.state).toBe("fulfilled");
    expect(fake.countOf("mintCharacter")).toBe(1);
  });

  it("provider failure → failed_retry, never refunds, throws to retry", async () => {
    const fake = new FakeChainProvider();
    fake.failOps.add("mintCharacter");
    ctx = await buildWorkerTestContext(fake);
    const { orderId, characterId } = await seedOrder(ctx);

    await expect(fulfillMintOrder(ctx, orderId, { manifest: MANIFEST })).rejects.toThrow();

    const order = (await ctx.db.select().from(mintOrders).where(eq(mintOrders.id, orderId)))[0]!;
    expect(order.state).toBe("failed_retry");
    const ch = (await ctx.db.select().from(characters).where(eq(characters.id, characterId)))[0]!;
    expect(ch.nftMint).toBeNull(); // no asset stamped
  });

  it("mints with a placeholder uri when the manifest is absent", async () => {
    const fake = new FakeChainProvider();
    ctx = await buildWorkerTestContext(fake);
    const { orderId } = await seedOrder(ctx);
    const res = await fulfillMintOrder(ctx, orderId); // no manifest
    expect(res.state).toBe("fulfilled");
    const call = fake.calls.find((c) => c.op === "mintCharacter")!.args as { uri: string };
    expect(call.uri).toMatch(/^trash-wars:\/\/character\//);
  });
});
