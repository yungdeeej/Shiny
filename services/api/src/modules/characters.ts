/** Character routes: list, station, idle claim, bail, upgrades, rename. */
import type { FastifyInstance } from "fastify";
import { bailPrice, idleRatePerHour, splitBail, upgradeCost } from "@trash-wars/economy";
import {
  POLICY,
  SINKS,
  renameRequest,
  stationRequest,
  upgradeRequest,
} from "@trash-wars/shared";
import { characters } from "@trash-wars/db";
import { desc, eq } from "../core/orm.js";
import { badRequest, conflict, insufficientFunds, notFound } from "../core/errors.js";
import { getUserAccount, unlockedBalance } from "../core/accounts.js";
import { characterToApi, type CharacterRow } from "../core/characters.js";
import { getLocation } from "../core/locations.js";
import { clampToEmissions, commitEmissions } from "../core/settle.js";
import { publishFeed } from "../core/feed.js";
import { requireTos } from "./session.js";

export default async function charactersModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  async function ownedCharacter(userId: string, id: string): Promise<CharacterRow> {
    const rows = await ctx.db.select().from(characters).where(eq(characters.id, id)).limit(1);
    const char = rows[0];
    if (!char || char.ownerUserId !== userId) throw notFound("character not found");
    return char;
  }

  app.get("/game/characters", async (request) => {
    const user = requireTos(request);
    const rows = await ctx.db
      .select()
      .from(characters)
      .where(eq(characters.ownerUserId, user.id))
      .orderBy(desc(characters.createdAt));
    return rows.map(characterToApi);
  });

  app.post<{ Params: { id: string } }>("/game/characters/:id/station", async (request) => {
    const user = requireTos(request);
    const { locationSlug } = stationRequest.parse(request.body);
    const char = await ownedCharacter(user.id, request.params.id);
    if (char.status !== "idle") throw conflict("CHARACTER_BUSY", `character is ${char.status}`);
    if (!char.inGame) throw badRequest("NOT_IN_GAME", "character is not staked in-game");
    if (locationSlug) await getLocation(ctx, locationSlug); // 404 on unknown
    await ctx.db
      .update(characters)
      .set({ stationedAt: locationSlug, lastClaimedAt: locationSlug ? new Date() : null })
      .where(eq(characters.id, char.id));
    return { ok: true, stationedAt: locationSlug };
  });

  app.post<{ Params: { id: string } }>("/game/characters/:id/claim-idle", async (request) => {
    const user = requireTos(request);
    const char = await ownedCharacter(user.id, request.params.id);
    if (!char.stationedAt) throw badRequest("NOT_STATIONED", "station the character first");
    if (char.status !== "idle") throw conflict("CHARACTER_BUSY", `character is ${char.status}`);
    const location = await getLocation(ctx, char.stationedAt);

    const now = new Date();
    const from = char.lastClaimedAt ?? char.createdAt;
    const hours = Math.min(
      ctx.clock.elapsedGameHours(from.getTime(), now.getTime()),
      POLICY.idleClaimCapHours,
    );
    const rate = idleRatePerHour(location.config, char.level);
    // Per-second resolution, bigint floor.
    const accrued = (rate * BigInt(Math.floor(hours * 3600))) / 3600n;
    if (accrued <= 0n) return { ok: true, amount: "0" };

    const granted = await clampToEmissions(ctx, accrued, now);
    if (granted <= 0n) {
      throw conflict("EMISSIONS_EXHAUSTED", "daily emissions budget exhausted — try tomorrow");
    }
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: ctx.accounts.emissions_budget, delta: -granted },
        { accountId: account, delta: granted },
      ],
      {
        idempotencyKey: `idle:${char.id}:${now.getTime()}`,
        refType: "idle_claim",
        refId: char.id,
      },
    );
    await commitEmissions(ctx, granted, now);
    await ctx.db
      .update(characters)
      .set({ lastClaimedAt: now })
      .where(eq(characters.id, char.id));
    return { ok: true, amount: granted.toString(), clamped: granted < accrued };
  });

  app.post<{ Params: { id: string } }>("/game/characters/:id/bail", async (request) => {
    const user = requireTos(request);
    const char = await ownedCharacter(user.id, request.params.id);
    if (char.status !== "jailed") throw conflict("NOT_JAILED", "character is not in jail");

    const price = bailPrice();
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < price) throw insufficientFunds();
    const { burn, pd } = splitBail(price);
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -price },
        { accountId: ctx.accounts.burn_pool, delta: burn },
        { accountId: ctx.accounts.pd_pool, delta: pd },
      ],
      { idempotencyKey: `bail:${char.id}:${Date.now()}`, refType: "bail", refId: char.id },
    );
    await ctx.db
      .update(characters)
      .set({ status: "idle", jailedUntil: null })
      .where(eq(characters.id, char.id));
    await publishFeed(ctx, {
      type: "burn",
      message: `🔓 ${char.name} posted bail and walked out of the tank`,
    });
    return { ok: true, price: price.toString() };
  });

  app.post<{ Params: { id: string } }>("/game/characters/:id/upgrade", async (request) => {
    const user = requireTos(request);
    const { stat } = upgradeRequest.parse(request.body);
    const char = await ownedCharacter(user.id, request.params.id);
    if (char.status === "dead") throw conflict("CHARACTER_DEAD", "the dead don't train");

    const current = char.stats[stat];
    if (current >= POLICY.statLevelCapS1) {
      throw conflict("STAT_CAPPED", `season 1 stat cap is ${POLICY.statLevelCapS1}`);
    }
    const cost = upgradeCost(current);
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < cost) throw insufficientFunds();
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -cost },
        { accountId: ctx.accounts.burn_pool, delta: cost },
      ],
      {
        idempotencyKey: `upgrade:${char.id}:${stat}:${current}`,
        refType: "stat_upgrade",
        refId: char.id,
      },
    );
    const stats = { ...char.stats, [stat]: current + 1 };
    // level = 1 + total upgrades purchased.
    const level = char.level + 1;
    await ctx.db.update(characters).set({ stats, level }).where(eq(characters.id, char.id));
    if (char.nftMint) {
      await ctx.chain.syncAttributes(char.nftMint, { ...stats, level }).catch((err) => {
        ctx.log.error({ err, characterId: char.id }, "syncAttributes failed");
      });
    }
    return { ok: true, stats, level, cost: cost.toString() };
  });

  app.post<{ Params: { id: string } }>("/game/characters/:id/rename", async (request) => {
    const user = requireTos(request);
    const { name } = renameRequest.parse(request.body);
    const char = await ownedCharacter(user.id, request.params.id);
    if (char.status === "dead") throw conflict("CHARACTER_DEAD", "let them rest");

    const price = SINKS.nameChange;
    const balances = await unlockedBalance(ctx.db, ctx.ledger, user.id);
    if (balances.unlocked < price) throw insufficientFunds();
    const account = await getUserAccount(ctx.ledger, user.id);
    await ctx.ledger.postTransaction(
      [
        { accountId: account, delta: -price },
        { accountId: ctx.accounts.burn_pool, delta: price },
      ],
      { idempotencyKey: `rename:${char.id}:${Date.now()}`, refType: "rename", refId: char.id },
    );
    await ctx.db.update(characters).set({ name }).where(eq(characters.id, char.id));
    return { ok: true, name };
  });
}
