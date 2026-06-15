/**
 * Helius deposit webhook (REAL mode). Verifies: secret auth, enhanced-payload
 * parsing, exactly-once credit under redelivery, unknown-memo → unattributed,
 * and the parser unit directly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { depositMemos, deposits, users } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import { build } from "../server.js";
import { parseHeliusDeposits } from "../modules/bank.js";
import { ledgerTotal } from "./helpers.js";

const SHINY = "SH1NYmint1111111111111111111111111111111111";
const DEPOSIT_OWNER = "DEP0SITaddr1111111111111111111111111111111";
const SECRET = "test-webhook-secret";

let app: FastifyInstance;
let userId: string;

/** Build the recorded enhanced payload: one SHINY transfer to the deposit addr. */
function enhancedPayload(sig: string, memo: string, uiAmount = "5000") {
  return [
    {
      signature: sig,
      memo,
      tokenTransfers: [
        {
          mint: SHINY,
          toUserAccount: DEPOSIT_OWNER,
          fromUserAccount: "SomeSender1111111111111111111111111111111",
          tokenAmount: uiAmount,
        },
      ],
    },
  ];
}

beforeAll(async () => {
  process.env.PGLITE_DIR = "memory://";
  app = await build({
    beta: false,
    env: {
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      LOG_LEVEL: "silent",
      SERVER_SEED_ENCRYPTION_KEY: "helius-test-key",
      SOLANA_RPC_URL: "https://api.devnet.solana.com",
      SHINY_MINT: SHINY,
      DEPOSIT_ADDRESS: DEPOSIT_OWNER,
      HELIUS_WEBHOOK_SECRET: SECRET,
    },
  });
  // Seed a user + their deposit memo directly.
  const u = await app.ctx.db
    .insert(users)
    .values({ handle: "depositor", isGuest: false })
    .returning();
  userId = u[0]!.id;
  await app.ctx.db.insert(depositMemos).values({ userId, memo: "MEMO1234" });
});

afterAll(async () => {
  await app.close();
});

async function userBalance(): Promise<bigint> {
  const account = await app.ctx.ledger.ensureAccount("user", userId, "game_balance");
  return app.ctx.ledger.getBalance(account);
}

describe("helius webhook", () => {
  it("rejects a missing/wrong secret with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/helius",
      headers: { authorization: "nope" },
      payload: enhancedPayload("sig-bad", "MEMO1234"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("credits a known-memo SHINY transfer exactly once; redelivery is idempotent", async () => {
    const before = await userBalance();
    const payload = enhancedPayload("sig-credit-1", "MEMO1234", "5000");

    // Deliver 5× (Helius retries). Should credit exactly once.
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/helius",
        headers: { authorization: SECRET },
        payload,
      });
      expect(res.statusCode).toBe(200);
    }

    // 5000 SHINY @ 6 decimals = 5_000_000_000 base units.
    expect((await userBalance()) - before).toBe(5_000_000_000n);

    const rows = await app.ctx.db
      .select()
      .from(deposits)
      .where(eq(deposits.txSig, "sig-credit-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("credited");
    expect(await ledgerTotal(app)).toBe(0n);
  });

  it("an unknown memo lands unattributed with no ledger credit", async () => {
    const before = await userBalance();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/helius",
      headers: { authorization: SECRET },
      payload: enhancedPayload("sig-unknown", "NOTAMEMO"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().unattributed).toBe(1);
    expect(res.json().credited).toBe(0);
    expect(await userBalance()).toBe(before);

    const rows = await app.ctx.db
      .select()
      .from(deposits)
      .where(eq(deposits.txSig, "sig-unknown"));
    expect(rows[0]!.state).toBe("unattributed");
    expect(rows[0]!.userId).toBeNull();
  });

  it("ignores transfers of other mints / to other destinations", () => {
    const parsed = parseHeliusDeposits(
      [
        {
          signature: "x",
          tokenTransfers: [
            { mint: "OTHERMINT", toUserAccount: DEPOSIT_OWNER, tokenAmount: "1" },
            { mint: SHINY, toUserAccount: "SomeoneElse", tokenAmount: "1" },
          ],
        },
      ],
      SHINY,
      DEPOSIT_OWNER,
    );
    expect(parsed).toHaveLength(0);
  });

  it("prefers rawTokenAmount base units when present", () => {
    const parsed = parseHeliusDeposits(
      [
        {
          signature: "y",
          tokenTransfers: [
            {
              mint: SHINY,
              toUserAccount: DEPOSIT_OWNER,
              rawTokenAmount: { tokenAmount: "1234567", decimals: 6 },
              tokenAmount: "1.234567",
            },
          ],
        },
      ],
      SHINY,
      DEPOSIT_OWNER,
    );
    expect(parsed).toEqual([{ txSig: "y", amount: 1_234_567n, memo: null }]);
  });
});
