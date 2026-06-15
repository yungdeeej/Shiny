/**
 * Mint fulfillment (doc 07). The API has already done the atomic supply
 * decrement + `user → burn_pool` burn (mint = burn) and created the character +
 * mint_orders row. This job performs the on-chain Metaplex Core mint and stamps
 * the asset id + banded stats onto the character.
 *
 * CRITICAL: the $SHINY was already burned by the API. On chain failure we NEVER
 * auto-refund — the order goes to `failed_retry` for an admin path, and the job
 * retries. Re-running a fulfilled order is a no-op (idempotent on order state).
 *
 * The schema is frozen: mint_orders has no detail column, so the durable on-chain
 * handle is `characters.nft_mint` (the asset id) and the manifest cursor is a KV
 * counter per faction. The tx signature is logged (no column to persist it).
 */
import { eq } from "../orm.js";
import { characters, mintEvents, mintOrders, wallets } from "@trash-wars/db";
import { getKv, setKv, type AppContext } from "@trash-wars/api/core";
import { nextAsset, statsFromBands, type Manifest } from "../chain/manifest.js";

export interface MintFulfillDeps {
  /** Resolved manifest (loaded once at boot) or undefined → placeholder path. */
  manifest?: Manifest;
  /** Owner wallet resolver override (tests). */
  ownerAddress?: (ctx: AppContext, userId: string) => Promise<string>;
}

const cursorKey = (faction: string) => `mint_manifest_cursor:${faction}`;

/** Primary wallet address, or the synthetic guest addr the tier system uses. */
async function defaultOwnerAddress(ctx: AppContext, userId: string): Promise<string> {
  const rows = await ctx.db
    .select({ address: wallets.address, isPrimary: wallets.isPrimary })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  const primary = rows.find((r) => r.isPrimary) ?? rows[0];
  return primary?.address ?? `guest:${userId}`;
}

export interface MintFulfillResult {
  orderId: string;
  state: "fulfilled" | "failed_retry";
  assetId?: string;
  signature?: string;
}

export async function fulfillMintOrder(
  ctx: AppContext,
  orderId: string,
  deps: MintFulfillDeps = {},
): Promise<MintFulfillResult> {
  const orderRows = await ctx.db.select().from(mintOrders).where(eq(mintOrders.id, orderId)).limit(1);
  const order = orderRows[0];
  if (!order) throw new Error(`mint order ${orderId} not found`);
  if (order.state === "fulfilled") {
    return { orderId, state: "fulfilled" }; // idempotent: already done
  }
  if (!order.characterId) throw new Error(`mint order ${orderId} has no character to mint`);

  const charRows = await ctx.db
    .select()
    .from(characters)
    .where(eq(characters.id, order.characterId))
    .limit(1);
  const character = charRows[0];
  if (!character) throw new Error(`character ${order.characterId} not found`);

  // A real asset id already present → on-chain part done; just mark fulfilled.
  const hasRealAsset =
    character.nftMint &&
    !character.nftMint.startsWith("BETA-") &&
    !character.nftMint.startsWith("DEVNET-SIM-");
  if (hasRealAsset) {
    await ctx.db.update(mintOrders).set({ state: "fulfilled" }).where(eq(mintOrders.id, orderId));
    return { orderId, state: "fulfilled", assetId: character.nftMint! };
  }

  const eventRows = await ctx.db.select().from(mintEvents).where(eq(mintEvents.id, order.eventId)).limit(1);
  const faction = (eventRows[0]?.faction ?? character.faction) as "raccoon" | "bloodhound";

  // Pick the manifest asset → uri + banded stats. Absent manifest → placeholder.
  let uri = `trash-wars://character/${character.dna}`;
  let stats = character.stats;
  let cursorAdvance: { faction: string; index: number } | undefined;
  if (deps.manifest) {
    const cursor = (await getKv<number>(ctx.db, cursorKey(faction))) ?? 0;
    // The cursor is "how many of this faction we've consumed"; skip that many.
    const consumed = new Set<number>(
      deps.manifest.assets
        .filter((a) => a.faction === faction)
        .sort((a, b) => a.index - b.index)
        .slice(0, cursor)
        .map((a) => a.index),
    );
    const asset = nextAsset(deps.manifest, faction, consumed);
    if (asset) {
      uri = asset.metadataUri;
      stats = statsFromBands(asset, orderId);
      cursorAdvance = { faction, index: asset.index };
    } else {
      ctx.log.warn({ orderId, faction }, "manifest exhausted for faction — using placeholder uri");
    }
  } else {
    ctx.log.warn({ orderId }, "no character manifest — minting with placeholder uri + existing stats");
  }

  const resolveOwner = deps.ownerAddress ?? defaultOwnerAddress;
  const owner = await resolveOwner(ctx, character.ownerUserId);

  try {
    const { assetId, signature } = await ctx.chain.mintCharacter({
      owner,
      name: character.name,
      faction,
      stats,
      uri,
    });

    await ctx.db
      .update(characters)
      .set({ nftMint: assetId, stats })
      .where(eq(characters.id, character.id));
    await ctx.db.update(mintOrders).set({ state: "fulfilled" }).where(eq(mintOrders.id, orderId));

    // Advance the manifest cursor only after a confirmed mint, so a failed mint
    // does not burn a manifest slot.
    if (cursorAdvance) {
      const cur = (await getKv<number>(ctx.db, cursorKey(cursorAdvance.faction))) ?? 0;
      await setKv(ctx.db, cursorKey(cursorAdvance.faction), cur + 1);
    }

    ctx.log.info({ orderId, assetId, signature }, "mint fulfilled on-chain");
    return { orderId, state: "fulfilled", assetId, signature };
  } catch (err) {
    // $SHINY already burned by the API — never auto-refund. Park for retry/admin.
    ctx.log.error({ orderId, err: String(err) }, "mint fulfillment failed — failed_retry (no refund)");
    await ctx.db
      .update(mintOrders)
      .set({ state: "failed_retry" })
      .where(eq(mintOrders.id, orderId));
    throw err; // let BullMQ retry the job
  }
}
