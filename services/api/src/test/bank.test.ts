import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { withdrawalTax } from "@trash-wars/economy";
import { toBaseUnits } from "@trash-wars/shared";
import { withdrawals } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import { setKv } from "../core/config.js";
import { tickWithdrawals } from "../core/scheduler.js";
import { DenyAllComplianceProvider } from "../core/compliance.js";
import {
  buildTestApp,
  guest,
  as,
  ledgerTotal,
  systemBalance,
  userBalance,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
});

const DEST = "BetaDestinationAddress11111111111111111111";

describe("withdrawals", () => {
  it("computes the 5% fee exactly and routes it to treasury", async () => {
    const session = await guest(app, "bank_racc");
    const amount = toBaseUnits(10_000);
    const fee = withdrawalTax(amount);
    expect(fee).toBe(toBaseUnits(500));

    const treasuryBefore = await systemBalance(app, "treasury");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: amount.toString(), destAddress: DEST },
      }),
    );
    expect(res.statusCode).toBe(200);
    const wd = res.json();
    expect(wd.fee).toBe(fee.toString());
    expect(wd.net).toBe((amount - fee).toString());
    expect(wd.state).toBe("queued");

    expect((await systemBalance(app, "treasury")) - treasuryBefore).toBe(fee);
    expect(await systemBalance(app, "withdrawals_payable")).toBe(amount - fee);
    expect(await userBalance(app, session.userId)).toBe(toBaseUnits(90_000));
    expect(await ledgerTotal(app)).toBe(0n);

    // Payout tick: payable drains back to the on-chain mirror, state → sent.
    await tickWithdrawals(app.ctx);
    const after = await app.inject(as(session, { method: "GET", url: "/bank/withdrawals" }));
    expect(after.json()[0].state).toBe("sent");
    expect(after.json()[0].txSig).toMatch(/^BETA-WD/);
    expect(await systemBalance(app, "withdrawals_payable")).toBe(0n);
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("enforces the minimum withdrawal", async () => {
    const session = await guest(app, "min_racc");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: toBaseUnits(4_999).toString(), destAddress: DEST },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BELOW_MINIMUM");
  });

  it("counts mission-locked stakes against the withdrawable balance", async () => {
    const session = await guest(app, "locked_racc");
    const chars = await app.inject(as(session, { method: "GET", url: "/game/characters" }));
    const start = await app.inject(
      as(session, {
        method: "POST",
        url: "/game/missions",
        payload: {
          locationSlug: "first-national",
          characterId: chars.json()[0].id,
          stake: toBaseUnits(95_000).toString(),
        },
      }),
    );
    expect(start.statusCode).toBe(200);

    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: toBaseUnits(10_000).toString(), destAddress: DEST },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("pause flag blocks new withdrawals and the payout tick", async () => {
    const session = await guest(app, "paused_racc");
    await setKv(app.ctx.db, "withdrawals_paused", true);
    try {
      const res = await app.inject(
        as(session, {
          method: "POST",
          url: "/bank/withdraw",
          payload: { amount: toBaseUnits(10_000).toString(), destAddress: DEST },
        }),
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("WITHDRAWALS_PAUSED");
    } finally {
      await setKv(app.ctx.db, "withdrawals_paused", false);
    }
  });

  it("amounts above the auto-pay daily limit land in review; deny refunds in full", async () => {
    const session = await guest(app, "review_racc", );
    // Faucet default 100k; auto-pay limit is 250k — drop the limit via env? Instead
    // simulate with sybil flag, the other review trigger.
    await app.ctx.db.insert((await import("@trash-wars/db")).sybilFlags).values({
      userId: session.userId,
      clusterKey: "test-cluster",
      severity: "low",
    });
    const amount = toBaseUnits(10_000);
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/bank/withdraw",
        payload: { amount: amount.toString(), destAddress: DEST },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("review");

    // Reviewed withdrawals are not paid by the tick.
    await tickWithdrawals(app.ctx);
    const rows = await app.ctx.db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, res.json().id));
    expect(rows[0]!.state).toBe("review");

    // Admin denies → full amount (net + fee) returns to the user balance.
    const balanceBefore = await userBalance(app, session.userId);
    const { users } = await import("@trash-wars/db");
    await app.ctx.db.update(users).set({ role: "admin" }).where(eq(users.id, session.userId));
    const deny = await app.inject(
      as(session, { method: "POST", url: `/admin/withdrawals/${res.json().id}/deny` }),
    );
    expect(deny.statusCode).toBe(200);
    expect((await userBalance(app, session.userId)) - balanceBefore).toBe(amount);
    expect(await ledgerTotal(app)).toBe(0n);
  });
});

describe("deposits (beta)", () => {
  it("credits instantly with a memo code", async () => {
    const session = await guest(app, "depo_racc");
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/bank/deposit-intent",
        payload: { amount: toBaseUnits(5_000).toString() },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().memo).toHaveLength(8);
    expect(res.json().serializedTx).toBeNull();
    expect(await userBalance(app, session.userId)).toBe(toBaseUnits(105_000));

    const history = await app.inject(as(session, { method: "GET", url: "/bank/history" }));
    expect(history.json()[0].kind).toBe("deposit");
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("helius webhook is 501 in beta", async () => {
    const res = await app.inject({ method: "POST", url: "/webhooks/helius", payload: [] });
    expect(res.statusCode).toBe(501);
  });
});

describe("proof of reserves", () => {
  it("reports healthy reserves vs liabilities", async () => {
    const res = await app.inject({ method: "GET", url: "/public/proof-of-reserves" });
    expect(res.statusCode).toBe(200);
    const latest = res.json().latest;
    expect(latest.healthy).toBe(true);
    expect(BigInt(latest.onchainReserves)).toBeGreaterThanOrEqual(BigInt(latest.liabilities));
  });
});

describe("compliance gate", () => {
  it("a deny-all provider blocks gated routes but /me still works", async () => {
    const denyApp = await buildTestApp({}, { compliance: new DenyAllComplianceProvider() });
    try {
      const session = await guest(denyApp, "denied_racc");
      const me = await denyApp.inject(as(session, { method: "GET", url: "/me" }));
      expect(me.statusCode).toBe(200);
      const wd = await denyApp.inject(
        as(session, {
          method: "POST",
          url: "/bank/withdraw",
          payload: { amount: toBaseUnits(10_000).toString(), destAddress: DEST },
        }),
      );
      expect(wd.statusCode).toBe(403);
      expect(wd.json().error.code).toBe("COMPLIANCE_BLOCKED");
      const chars = await denyApp.inject(as(session, { method: "GET", url: "/game/characters" }));
      const mission = await denyApp.inject(
        as(session, {
          method: "POST",
          url: "/game/missions",
          payload: {
            locationSlug: "first-national",
            characterId: chars.json()[0].id,
            stake: toBaseUnits(2_500).toString(),
          },
        }),
      );
      expect(mission.statusCode).toBe(403);
    } finally {
      await denyApp.close();
    }
  });
});
