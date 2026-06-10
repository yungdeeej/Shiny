/** Auth module: SIWS nonce/verify, beta guest accounts + faucet, sessions, /me. */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  buildSiwsMessage,
  isValidSolanaAddress,
  verifySiwsSignature,
} from "@trash-wars/chain";
import { sha256Hex } from "@trash-wars/economy";
import {
  TOS_VERSION,
  acceptTosRequest,
  guestLoginRequest,
  nonceRequest,
  verifyRequest,
  type MeResponse,
} from "@trash-wars/shared";
import { characters, loginFragments, sessions, sybilFlags, users, wallets } from "@trash-wars/db";
import { and, eq } from "../core/orm.js";
import { AppError, badRequest, conflict, unauthorized } from "../core/errors.js";
import { getCounter, addToCounter, getKv, setKv } from "../core/config.js";
import { unlockedBalance } from "../core/accounts.js";
import { utcDayKey } from "../core/time.js";
import { createSession, requireAuth, setSessionCookie } from "./session.js";

interface NonceRecord {
  nonce: string;
  message: string;
  expiresAt: number;
}

const NONCE_TTL_MS = 5 * 60 * 1000;

function isPgUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unique|duplicate key/i.test(message);
}

export default async function authModule(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  // In-memory, single-use nonce store with 5-minute TTL (per doc 04).
  const nonces = new Map<string, NonceRecord>();

  app.post("/auth/nonce", async (request) => {
    const { address } = nonceRequest.parse(request.body);
    if (!isValidSolanaAddress(address)) throw badRequest("BAD_ADDRESS", "invalid Solana address");
    const nonce = randomBytes(16).toString("hex");
    const message = buildSiwsMessage({
      domain: new URL(ctx.env.webOrigin).host,
      address,
      statement: "Sign in to Trash Wars",
      nonce,
      issuedAt: new Date().toISOString(),
    });
    nonces.set(address, { nonce, message, expiresAt: Date.now() + NONCE_TTL_MS });
    return { nonce, message };
  });

  app.post("/auth/verify", async (request, reply) => {
    const body = verifyRequest.parse(request.body);
    const record = nonces.get(body.address);
    if (!record || record.expiresAt < Date.now()) {
      nonces.delete(body.address);
      throw unauthorized("nonce expired or unknown — request a new one");
    }
    nonces.delete(body.address); // single use, consumed even on failure
    if (!verifySiwsSignature(record.message, body.signature, body.address)) {
      throw unauthorized("signature verification failed");
    }

    // Upsert wallet → user.
    const existing = await ctx.db
      .select()
      .from(wallets)
      .where(eq(wallets.address, body.address))
      .limit(1);
    let userId: string;
    if (existing[0]) {
      userId = existing[0].userId;
    } else {
      const handle = `racc_${body.address.slice(0, 8)}`;
      let userRows;
      try {
        userRows = await ctx.db.insert(users).values({ handle }).returning();
      } catch (err) {
        if (!isPgUniqueViolation(err)) throw err;
        userRows = await ctx.db
          .insert(users)
          .values({ handle: `${handle}_${randomBytes(2).toString("hex")}` })
          .returning();
      }
      userId = userRows[0]!.id;
      // First wallet linked becomes the primary withdrawal wallet.
      await ctx.db.insert(wallets).values({ userId, address: body.address, isPrimary: true });
    }
    // Anti-sybil: the fingerprint hash is persisted on the session row.
    const session = await createSession(ctx, userId, body.fingerprint);
    setSessionCookie(ctx, reply, session.token);
    return { ok: true, userId };
  });

  app.post("/auth/guest", async (request, reply) => {
    if (!ctx.env.beta) throw new AppError("BETA_ONLY", "guest login is beta-only", 403);
    const { handle } = guestLoginRequest.parse(request.body);

    let userRows;
    try {
      userRows = await ctx.db
        .insert(users)
        .values({ handle, isGuest: true, tosVersion: TOS_VERSION })
        .returning();
    } catch (err) {
      if (isPgUniqueViolation(err)) throw conflict("HANDLE_TAKEN", `handle '${handle}' is taken`);
      throw err;
    }
    const user = userRows[0]!;

    // Beta faucet: starting balance from the on-chain mirror.
    const account = await ctx.ledger.ensureAccount("user", user.id, "game_balance");
    await ctx.ledger.postTransaction(
      [
        { accountId: ctx.accounts.onchain_reserve_mirror, delta: -ctx.env.betaFaucetAmount },
        { accountId: account, delta: ctx.env.betaFaucetAmount },
      ],
      { idempotencyKey: `faucet:${user.id}:0`, refType: "beta_faucet", refId: user.id },
    );

    // One starter raccoon so the loop is playable immediately.
    await ctx.db.insert(characters).values({
      ownerUserId: user.id,
      name: `Sly ${handle}`,
      faction: "raccoon",
      level: 1,
      stats: { stealth: 1, muscle: 1, luck: 1, reputation: 0 },
      dna: sha256Hex(user.id).slice(0, 16),
      status: "idle",
      inGame: true,
    });

    const session = await createSession(ctx, user.id);
    setSessionCookie(ctx, reply, session.token);
    return { ok: true, userId: user.id, handle };
  });

  app.post("/beta/faucet", async (request) => {
    if (!ctx.env.beta) throw new AppError("BETA_ONLY", "faucet is beta-only", 403);
    const user = requireAuth(request);
    const lastAt = await getKv<number>(ctx.db, `faucet_at:${user.id}`);
    if (lastAt && Date.now() - lastAt < 60 * 60 * 1000) {
      throw new AppError("RATE_LIMITED", "faucet available once per hour", 429);
    }
    const n = (await getCounter(ctx.db, `faucet_n:${user.id}`)) + 1n;
    const account = await ctx.ledger.ensureAccount("user", user.id, "game_balance");
    await ctx.ledger.postTransaction(
      [
        { accountId: ctx.accounts.onchain_reserve_mirror, delta: -ctx.env.betaFaucetAmount },
        { accountId: account, delta: ctx.env.betaFaucetAmount },
      ],
      { idempotencyKey: `faucet:${user.id}:${n}`, refType: "beta_faucet", refId: user.id },
    );
    await addToCounter(ctx.db, `faucet_n:${user.id}`, 1n);
    await setKv(ctx.db, `faucet_at:${user.id}`, Date.now());
    return { ok: true, amount: ctx.env.betaFaucetAmount.toString() };
  });

  app.post("/auth/logout", async (request, reply) => {
    const user = requireAuth(request);
    await ctx.db.delete(sessions).where(eq(sessions.id, user.sessionId));
    reply.clearCookie(ctx.env.sessionCookieName, { path: "/" });
    return { ok: true };
  });

  app.post("/auth/logout-all", async (request, reply) => {
    const user = requireAuth(request);
    await ctx.db.delete(sessions).where(eq(sessions.userId, user.id));
    reply.clearCookie(ctx.env.sessionCookieName, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (request) => {
    const user = requireAuth(request);

    // Daily login fragment (raffle ticket fragments, 5 → 1 ticket on /raffles).
    await ctx.db
      .insert(loginFragments)
      .values({ userId: user.id, day: utcDayKey() })
      .onConflictDoNothing();

    const [walletRows, balances, flags, userRow] = await Promise.all([
      ctx.db.select().from(wallets).where(eq(wallets.userId, user.id)),
      unlockedBalance(ctx.db, ctx.ledger, user.id),
      ctx.db.select().from(sybilFlags).where(eq(sybilFlags.userId, user.id)),
      ctx.db.select().from(users).where(eq(users.id, user.id)).limit(1),
    ]);
    const u = userRow[0]!;

    const response: MeResponse = {
      id: u.id,
      handle: u.handle,
      isGuest: u.isGuest,
      wallets: walletRows.map((w) => ({
        address: w.address,
        isPrimary: w.isPrimary,
        pendingPrimaryAt: w.pendingPrimaryAt ? w.pendingPrimaryAt.toISOString() : null,
      })),
      balance: balances.balance.toString(),
      lockedBalance: balances.locked.toString(),
      tosAcceptedVersion: u.tosVersion,
      flags: [
        ...(u.frozen ? ["frozen"] : []),
        ...flags.map((f) => `sybil:${f.clusterKey}`),
      ],
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    };
    return response;
  });

  app.post("/me/accept-tos", async (request) => {
    const user = requireAuth(request);
    const { version } = acceptTosRequest.parse(request.body);
    if (version !== TOS_VERSION) {
      throw badRequest("TOS_VERSION_MISMATCH", `current ToS version is ${TOS_VERSION}`);
    }
    await ctx.db
      .update(users)
      .set({ tosVersion: version, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { ok: true, version };
  });
}
