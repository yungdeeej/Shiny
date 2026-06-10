import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, migrateDb, type Db } from "./client.js";
import { LedgerService, type SystemAccountKind } from "./ledger.js";

process.env.PGLITE_DIR = "memory://";

let db: Db;
let ledger: LedgerService;
let sys: Record<SystemAccountKind, string>;

function userAccount(): Promise<string> {
  return ledger.ensureAccount("user", randomUUID(), "game_balance");
}

beforeAll(async () => {
  db = createDb();
  await migrateDb(db);
  ledger = new LedgerService(db);
  sys = await ledger.ensureSystemAccounts();
});

describe("migrateDb", () => {
  it("is idempotent (safe to run twice)", async () => {
    await expect(migrateDb(db)).resolves.toBeUndefined();
  });

  it("ensureSystemAccounts is idempotent and returns stable ids", async () => {
    const again = await ledger.ensureSystemAccounts();
    expect(again).toEqual(sys);
  });

  it("v1.1: jackpot_pool is a system account and posts ledger legs", async () => {
    expect(sys.jackpot_pool).toBeTruthy();
    const posted = await ledger.postTransaction(
      [
        { accountId: sys.jackpot_pool, delta: 555n },
        { accountId: sys.onchain_reserve_mirror, delta: -555n },
      ],
      { idempotencyKey: `jackpot-test:${randomUUID()}` },
    );
    expect(posted.applied).toBe(true);
    await expect(ledger.getBalance(sys.jackpot_pool)).resolves.toBe(555n);
  });

  it("v1.1: enum extension upgrades a pre-v1.1 database (ALTER TYPE ADD VALUE IF NOT EXISTS)", async () => {
    const { createDb, closeDb, migrateDb: migrate } = await import("./client.js");
    const { sql } = await import("drizzle-orm");
    const old = createDb(); // fresh in-memory PGlite
    try {
      // Simulate a database created BEFORE v1.1: account_kind without jackpot_pool.
      await old.execute(
        sql.raw(
          `CREATE TYPE "account_kind" AS ENUM ('game_balance','treasury','burn_pool','pd_pool',` +
            `'emissions_budget','emissions_reserve','mission_escrow','withdrawals_payable',` +
            `'onchain_reserve_mirror','burned')`,
        ),
      );
      await migrate(old); // CREATE TYPE swallowed; ALTER adds jackpot_pool
      await migrate(old); // and stays idempotent on re-run
      const oldLedger = new LedgerService(old);
      const accounts = await oldLedger.ensureSystemAccounts();
      expect(accounts.jackpot_pool).toBeTruthy();
    } finally {
      await closeDb(old);
    }
  });
});

describe("postTransaction validation", () => {
  it("rejects transactions with fewer than 2 entries", async () => {
    const a = await userAccount();
    await expect(
      ledger.postTransaction([{ accountId: a, delta: 100n }], { idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/at least 2 entries/);
  });

  it("rejects zero deltas", async () => {
    const a = await userAccount();
    await expect(
      ledger.postTransaction(
        [
          { accountId: a, delta: 0n },
          { accountId: sys.treasury, delta: 0n },
        ],
        { idempotencyKey: randomUUID() },
      ),
    ).rejects.toThrow(/non-zero/);
  });

  it("rejects unbalanced transactions", async () => {
    const a = await userAccount();
    await expect(
      ledger.postTransaction(
        [
          { accountId: a, delta: 100n },
          { accountId: sys.treasury, delta: -99n },
        ],
        { idempotencyKey: randomUUID() },
      ),
    ).rejects.toThrow(/unbalanced/);
    await expect(ledger.getBalance(a)).resolves.toBe(0n);
  });
});

describe("idempotency", () => {
  it("replaying the same key applies exactly once and leaves balances unchanged", async () => {
    const a = await userAccount();
    const key = `test:${randomUUID()}`;
    const entries = [
      { accountId: a, delta: 1_000n },
      { accountId: sys.treasury, delta: -1_000n },
    ];

    const first = await ledger.postTransaction(entries, { idempotencyKey: key });
    expect(first.applied).toBe(true);
    expect(first.txnId).toBeTruthy();

    const replay = await ledger.postTransaction(entries, { idempotencyKey: key });
    expect(replay.applied).toBe(false);
    expect(replay.txnId).toBe(first.txnId);

    await expect(ledger.getBalance(a)).resolves.toBe(1_000n);
  });

  it("10 concurrent identical posts → exactly one applied (unique constraint arbiters)", async () => {
    const a = await userAccount();
    const key = `race:${randomUUID()}`;
    const entries = [
      { accountId: a, delta: 100n },
      { accountId: sys.burn_pool, delta: -100n },
    ];

    const results = await Promise.all(
      Array.from({ length: 10 }, () => ledger.postTransaction(entries, { idempotencyKey: key })),
    );

    const applied = results.filter((r) => r.applied);
    expect(applied).toHaveLength(1);
    // Every replay reports the winner's txn id.
    expect(new Set(results.map((r) => r.txnId))).toEqual(new Set([applied[0]!.txnId]));
    // Final balance equals exactly one application.
    await expect(ledger.getBalance(a)).resolves.toBe(100n);
    });
});

describe("balances", () => {
  it("sums with bigint precision beyond 2^53", async () => {
    const a = await userAccount();
    const big = 9_007_199_254_740_993n; // 2^53 + 1 — not representable as a double
    for (let i = 0; i < 3; i++) {
      await ledger.postTransaction(
        [
          { accountId: a, delta: big },
          { accountId: sys.emissions_reserve, delta: -big },
        ],
        { idempotencyKey: `big:${a}:${i}` },
      );
    }
    await expect(ledger.getBalance(a)).resolves.toBe(big * 3n);
  });

  it("getBalances batches and defaults missing accounts to 0n", async () => {
    const a = await userAccount();
    const b = await userAccount();
    await ledger.postTransaction(
      [
        { accountId: a, delta: 42n },
        { accountId: sys.treasury, delta: -42n },
      ],
      { idempotencyKey: `batch:${a}` },
    );
    const balances = await ledger.getBalances([a, b]);
    expect(balances.get(a)).toBe(42n);
    expect(balances.get(b)).toBe(0n);
  });

  it("getBalance of an account with no entries is 0n", async () => {
    const a = await userAccount();
    await expect(ledger.getBalance(a)).resolves.toBe(0n);
  });
});
