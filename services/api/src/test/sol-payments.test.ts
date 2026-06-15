/**
 * SOL payment rail (doc 11 + doc 13 §4): build-intent → confirm flow.
 *
 * The RPC is mocked end-to-end via the injectable seam (configureSolRail({rpc}))
 * — no live chain. Fixtures are built from the rail's own unsigned tx so the
 * verifier exercises the exact on-chain shape it will see on devnet.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { wallets } from "@trash-wars/db";
import { eq } from "../core/orm.js";
import {
  buildSolPayment,
  bs58Encode,
  configureSolRail,
  parseMemo,
  resetSolRail,
  solToLamports,
  verifySolPayment,
  type RpcTransaction,
  type SolRpc,
  MEMO_PROGRAM_ID,
} from "../core/sol-payments.js";
import { buildTestApp, guest, as, type TestSession } from "./helpers.js";

const REVENUE = Keypair.generate().publicKey.toBase58();
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const BLOCKHASH = "11111111111111111111111111111111";

/** A fake RPC: a fixed blockhash + a map of txSig → fixture (or absent). */
function fakeRpc(fixtures: Map<string, RpcTransaction | null>): SolRpc {
  return {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }),
    getTransaction: async (sig) => {
      if (!fixtures.has(sig)) return null;
      return fixtures.get(sig) ?? null;
    },
  };
}

/**
 * Build the on-chain getTransaction shape for a confirmed payment: a System
 * transfer (variant 2 + u64 lamports) payer→dest plus a memo instruction.
 */
function txFixture(opts: {
  payer: string;
  dest: string;
  lamports: number;
  memo: string;
  err?: unknown;
}): RpcTransaction {
  const keys = [opts.payer, opts.dest, SYSTEM_PROGRAM, MEMO_PROGRAM_ID];
  const transferData = Buffer.alloc(12);
  transferData.writeUInt32LE(2, 0); // SystemInstruction::Transfer
  transferData.writeBigUInt64LE(BigInt(opts.lamports), 4);
  return {
    meta: { err: opts.err ?? null },
    transaction: {
      message: {
        accountKeys: keys,
        instructions: [
          { programIdIndex: 2, accounts: [0, 1], data: bs58Encode(transferData) },
          { programIdIndex: 3, accounts: [], data: bs58Encode(Buffer.from(opts.memo, "utf8")) },
        ],
      },
    },
  };
}

describe("buildSolPayment", () => {
  it("returns a deserializable unsigned tx to the right dest for the right lamports with the memo", async () => {
    const payer = Keypair.generate().publicKey.toBase58();
    const rpc = fakeRpc(new Map());
    const built = await buildSolPayment({
      payer,
      product: "cosmetic",
      ref: "shorefront-silk-scarf",
      lamports: solToLamports(0.5),
      revenueWallet: REVENUE,
      rpc,
    });

    expect(built.reference).toMatch(/^[0-9a-f]{32}$/);
    expect(built.memo).toContain(built.reference);
    expect(built.memo).toContain("shorefront-silk-scarf");

    const tx = VersionedTransaction.deserialize(Buffer.from(built.serializedTx, "base64"));
    // Unsigned: signatures array is all-zero.
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(payer);
    expect(keys).toContain(REVENUE);
    expect(keys).toContain(MEMO_PROGRAM_ID);

    const parsed = parseMemo(built.memo);
    expect(parsed).toEqual({
      product: "cosmetic",
      ref: "shorefront-silk-scarf",
      reference: built.reference,
    });
  });
});

describe("verifySolPayment", () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const reference = "deadbeefdeadbeefdeadbeefdeadbeef";
  const lamports = solToLamports(0.5);
  const memo = `tw:cosmetic:shorefront-silk-scarf:${reference}`;
  const base = { reference, expectedPayer: payer, expectedLamports: lamports, revenueWallet: REVENUE };

  it("accepts a correct payment", async () => {
    const rpc = fakeRpc(new Map([["sig", txFixture({ payer, dest: REVENUE, lamports, memo })]]));
    const r = await verifySolPayment({ ...base, txSig: "sig", rpc });
    expect(r.ok).toBe(true);
    expect(r.memo).toBe(memo);
  });

  it("rejects wrong amount", async () => {
    const rpc = fakeRpc(
      new Map([["sig", txFixture({ payer, dest: REVENUE, lamports: lamports - 1, memo })]]),
    );
    const r = await verifySolPayment({ ...base, txSig: "sig", rpc });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wrong_amount");
  });

  it("rejects wrong payer", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    const rpc = fakeRpc(new Map([["sig", txFixture({ payer: other, dest: REVENUE, lamports, memo })]]));
    const r = await verifySolPayment({ ...base, txSig: "sig", rpc });
    expect(r.ok).toBe(false);
  });

  it("rejects wrong destination", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    const rpc = fakeRpc(new Map([["sig", txFixture({ payer, dest: other, lamports, memo })]]));
    const r = await verifySolPayment({ ...base, txSig: "sig", rpc });
    expect(r.ok).toBe(false);
  });

  it("rejects a missing/incorrect memo", async () => {
    const rpc = fakeRpc(
      new Map([["sig", txFixture({ payer, dest: REVENUE, lamports, memo: "tw:cosmetic:x:other" })]]),
    );
    const r = await verifySolPayment({ ...base, txSig: "sig", rpc });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing_memo");
  });

  it("rejects a tx error", async () => {
    const rpc = fakeRpc(
      new Map([["sig", txFixture({ payer, dest: REVENUE, lamports, memo, err: { InstructionError: [0, "X"] } })]]),
    );
    const r = await verifySolPayment({ ...base, txSig: "sig", rpc });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("tx_failed");
  });

  it("rejects an unknown/garbage sig", async () => {
    const rpc = fakeRpc(new Map());
    const r = await verifySolPayment({ ...base, txSig: "nope", rpc });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("tx_not_found");
  });
});

/* ── route-level: store/confirm + pass/confirm idempotent grant ───────── */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  resetSolRail();
});
afterEach(() => {
  resetSolRail();
});

/** Give a guest a primary wallet (the SOL-rail payer binding). */
async function linkWallet(session: TestSession, address: string): Promise<void> {
  await app.ctx.db
    .delete(wallets)
    .where(eq(wallets.userId, session.userId))
    .catch(() => undefined);
  await app.ctx.db.insert(wallets).values({ userId: session.userId, address, isPrimary: true });
}

describe("store SOL rail (configured)", () => {
  it("buy builds an intent and confirm grants once; replay is idempotent", async () => {
    const fixtures = new Map<string, RpcTransaction | null>();
    const rpc = fakeRpc(fixtures);
    configureSolRail({ env: { REVENUE_WALLET: REVENUE }, rpc });

    const session = await guest(app, "sol_store_buyer");
    const payerKp = Keypair.generate();
    const payer = payerKp.publicKey.toBase58();
    await linkWallet(session, payer);

    const buy = await app.inject(
      as(session, { method: "POST", url: "/store/buy", payload: { itemSlug: "shorefront-silk-scarf" } }),
    );
    expect(buy.statusCode).toBe(200);
    const intent = buy.json();
    expect(intent.product).toBe("cosmetic");
    expect(intent.ref).toBe("shorefront-silk-scarf");
    expect(intent.revenueWallet).toBe(REVENUE);
    expect(intent.lamports).toBe(solToLamports(0.5));

    // Stage the confirmed on-chain tx matching the intent.
    fixtures.set(
      "store-sig-0000000000000000000000000000",
      txFixture({ payer, dest: REVENUE, lamports: intent.lamports, memo: intent.memo }),
    );

    const confirm = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/confirm",
        payload: { txSig: "store-sig-0000000000000000000000000000", reference: intent.reference },
      }),
    );
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().granted).toBe(true);
    expect(confirm.json().alreadyGranted).toBe(false);

    const inv = await app.inject(as(session, { method: "GET", url: "/store/inventory" }));
    expect(
      inv.json().filter((r: { item: { slug: string } }) => r.item.slug === "shorefront-silk-scarf"),
    ).toHaveLength(1);

    // Replay the same signature → idempotent, no second grant.
    const again = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/confirm",
        payload: { txSig: "store-sig-0000000000000000000000000000", reference: intent.reference },
      }),
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyGranted).toBe(true);
    const inv2 = await app.inject(as(session, { method: "GET", url: "/store/inventory" }));
    expect(
      inv2.json().filter((r: { item: { slug: string } }) => r.item.slug === "shorefront-silk-scarf"),
    ).toHaveLength(1);
  });

  it("a SHINY item cannot be confirmed via the SOL rail (memo product/ref mismatch)", async () => {
    const fixtures = new Map<string, RpcTransaction | null>();
    const rpc = fakeRpc(fixtures);
    configureSolRail({ env: { REVENUE_WALLET: REVENUE }, rpc });
    const session = await guest(app, "sol_store_shiny");
    const payer = Keypair.generate().publicKey.toBase58();
    await linkWallet(session, payer);

    // A tx whose memo points at a SHINY-only cosmetic → priceLamports rejects.
    const reference = "aaaa".repeat(8);
    fixtures.set("shiny-sig-0000000000000000000000000000", txFixture({
      payer,
      dest: REVENUE,
      lamports: 500,
      memo: `tw:cosmetic:wet-felt-fedora:${reference}`,
    }));
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/confirm",
        payload: { txSig: "shiny-sig-0000000000000000000000000000", reference },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("a season_pass memo cannot be confirmed on the store rail", async () => {
    const fixtures = new Map<string, RpcTransaction | null>();
    const rpc = fakeRpc(fixtures);
    configureSolRail({ env: { REVENUE_WALLET: REVENUE }, rpc });
    const session = await guest(app, "sol_store_crossed");
    const payer = Keypair.generate().publicKey.toBase58();
    await linkWallet(session, payer);
    const reference = "bbbb".repeat(8);
    fixtures.set("pass-on-store-0000000000000000000000000000", txFixture({
      payer,
      dest: REVENUE,
      lamports: solToLamports(0.3),
      memo: `tw:season_pass:premium:${reference}`,
    }));
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/store/confirm",
        payload: { txSig: "pass-on-store-0000000000000000000000000000", reference },
      }),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("pass SOL rail (configured)", () => {
  it("buy builds a season_pass intent; confirm grants premium once; replay idempotent", async () => {
    const fixtures = new Map<string, RpcTransaction | null>();
    const rpc = fakeRpc(fixtures);
    configureSolRail({ env: { REVENUE_WALLET: REVENUE }, rpc });

    const session = await guest(app, "sol_pass_buyer");
    const payer = Keypair.generate().publicKey.toBase58();
    await linkWallet(session, payer);

    const buy = await app.inject(as(session, { method: "POST", url: "/pass/buy" }));
    expect(buy.statusCode).toBe(200);
    const intent = buy.json();
    expect(intent.product).toBe("season_pass");
    expect(intent.ref).toBe("premium");
    expect(intent.lamports).toBe(solToLamports(0.3));
    // NOT the beta instant-grant shape.
    expect(intent.receipt).toBeUndefined();

    // Premium not granted until confirm.
    const before = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    expect(before.premium).toBe(false);

    fixtures.set(
      "pass-sig-00000000000000000000000000000",
      txFixture({ payer, dest: REVENUE, lamports: intent.lamports, memo: intent.memo }),
    );
    const confirm = await app.inject(
      as(session, {
        method: "POST",
        url: "/pass/confirm",
        payload: { txSig: "pass-sig-00000000000000000000000000000", reference: intent.reference },
      }),
    );
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().granted).toBe(true);
    expect(confirm.json().alreadyGranted).toBe(false);

    const after = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    expect(after.premium).toBe(true);

    const replay = await app.inject(
      as(session, {
        method: "POST",
        url: "/pass/confirm",
        payload: { txSig: "pass-sig-00000000000000000000000000000", reference: intent.reference },
      }),
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json().alreadyGranted).toBe(true);
  });

  it("rejects a wrong-payer confirm (someone else's signature)", async () => {
    const fixtures = new Map<string, RpcTransaction | null>();
    const rpc = fakeRpc(fixtures);
    configureSolRail({ env: { REVENUE_WALLET: REVENUE }, rpc });
    const session = await guest(app, "sol_pass_thief");
    const payer = Keypair.generate().publicKey.toBase58();
    await linkWallet(session, payer);

    const buy = await app.inject(as(session, { method: "POST", url: "/pass/buy" }));
    const intent = buy.json();
    // The on-chain payer is a DIFFERENT wallet than the user's primary.
    const stranger = Keypair.generate().publicKey.toBase58();
    fixtures.set(
      "thief-sig-0000000000000000000000000000",
      txFixture({ payer: stranger, dest: REVENUE, lamports: intent.lamports, memo: intent.memo }),
    );
    const res = await app.inject(
      as(session, {
        method: "POST",
        url: "/pass/confirm",
        payload: { txSig: "thief-sig-0000000000000000000000000000", reference: intent.reference },
      }),
    );
    expect(res.statusCode).toBe(400);
    const after = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    expect(after.premium).toBe(false);
  });
});

describe("config-off (no REVENUE_WALLET): rail disabled cleanly", () => {
  it("SOL cosmetic buy 501s, SHINY buy + beta premium unchanged", async () => {
    resetSolRail(); // beta env has no REVENUE_WALLET → disabled
    const session = await guest(app, "beta_user");

    // SOL-priced cosmetic → 501 stub.
    const sol = await app.inject(
      as(session, { method: "POST", url: "/store/buy", payload: { itemSlug: "shorefront-silk-scarf" } }),
    );
    expect(sol.statusCode).toBe(501);

    // SHINY rail still works (100% burn).
    const shiny = await app.inject(
      as(session, { method: "POST", url: "/store/buy", payload: { itemSlug: "wet-felt-fedora" } }),
    );
    expect(shiny.statusCode).toBe(200);
    expect(shiny.json().userCosmeticId).toBeTruthy();

    // Beta instant-premium path preserved.
    const buy = await app.inject(as(session, { method: "POST", url: "/pass/buy" }));
    expect(buy.statusCode).toBe(200);
    expect(buy.json().receipt).toMatch(/^BETA-PASS-/);
    const state = (await app.inject(as(session, { method: "GET", url: "/pass" }))).json();
    expect(state.premium).toBe(true);
  });

  it("an invalid REVENUE_WALLET disables the rail (not a base58 pubkey)", () => {
    const rail = configureSolRail({ env: { REVENUE_WALLET: "not-a-real-pubkey" } });
    expect(rail.config.enabled).toBe(false);
  });
});

describe("base58 round-trip", () => {
  it("encode matches web3.js for a pubkey, and decode inverts encode", async () => {
    const { bs58Decode } = await import("../core/sol-payments.js");
    // Encoding a pubkey's bytes reproduces its canonical base58 string.
    const pk = new PublicKey(REVENUE);
    expect(bs58Encode(pk.toBytes())).toBe(REVENUE);
    // Round-trip arbitrary bytes incl. leading zeros.
    const data = Buffer.from([0, 0, 1, 2, 255, 254, 0]);
    expect([...bs58Decode(bs58Encode(data))]).toEqual([...data]);
  });
});
