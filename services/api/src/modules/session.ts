/**
 * Session plumbing shared by all modules: cookie → sessions row → request.user,
 * plus the auth / ToS / admin / compliance guards.
 */
import { randomBytes, createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TOS_VERSION } from "@trash-wars/shared";
import { sessions, users } from "@trash-wars/db";
import { and, eq, gt } from "../core/orm.js";
import type { AppContext } from "../core/context.js";
import { AppError, forbidden, unauthorized } from "../core/errors.js";

export interface SessionUser {
  id: string;
  handle: string;
  role: "player" | "admin";
  isGuest: boolean;
  tosVersion: string | null;
  frozen: boolean;
  feedAnonymous: boolean;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export function hashFingerprint(fp: string): string {
  return createHash("sha256").update(fp).digest("hex");
}

export async function createSession(
  ctx: AppContext,
  userId: string,
  fingerprint?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ctx.env.sessionTtlMs);
  await ctx.db.insert(sessions).values({
    id: token,
    userId,
    fingerprintHash: fingerprint ? hashFingerprint(fingerprint) : null,
    expiresAt,
  });
  return { token, expiresAt };
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string): void {
  reply.setCookie(ctx.env.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.env.isProd,
    path: "/",
    maxAge: Math.floor(ctx.env.sessionTtlMs / 1000),
  });
}

/** Root onRequest hook: resolves the session cookie into request.user (sliding 7d). */
export function sessionHook(ctx: AppContext) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies?.[ctx.env.sessionCookieName];
    if (!token) return;
    const rows = await ctx.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row) return;

    // Sliding expiry: refresh once the session is past half its lifetime.
    const remaining = row.session.expiresAt.getTime() - Date.now();
    if (remaining < ctx.env.sessionTtlMs / 2) {
      const expiresAt = new Date(Date.now() + ctx.env.sessionTtlMs);
      await ctx.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, token));
      setSessionCookie(ctx, reply, token);
    }

    request.user = {
      id: row.user.id,
      handle: row.user.handle,
      role: row.user.role,
      isGuest: row.user.isGuest,
      tosVersion: row.user.tosVersion,
      frozen: row.user.frozen,
      feedAnonymous: row.user.feedAnonymous,
      sessionId: row.session.id,
    };
  };
}

/* ── guards ───────────────────────────────────────────────────────── */

export function requireAuth(request: FastifyRequest): SessionUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function requireTos(request: FastifyRequest): SessionUser {
  const user = requireAuth(request);
  if (user.tosVersion !== TOS_VERSION) {
    throw new AppError("TOS_NOT_ACCEPTED", `accept ToS version ${TOS_VERSION} first`, 403);
  }
  return user;
}

export function requireAdmin(request: FastifyRequest): SessionUser {
  const user = requireAuth(request);
  if (user.role !== "admin") throw forbidden("admin only");
  return user;
}

export function requireNotFrozen(user: SessionUser): SessionUser {
  if (user.frozen) throw forbidden("account frozen — contact support");
  return user;
}

/** complianceGate(action): pluggable external decision before deposit/play/withdraw. */
export async function complianceGate(
  ctx: AppContext,
  request: FastifyRequest,
  action: "deposit" | "play" | "withdraw",
): Promise<SessionUser> {
  const user = requireAuth(request);
  const decision = await ctx.compliance.check(
    { id: user.id, role: user.role, isGuest: user.isGuest },
    action,
  );
  if (decision !== "allow") {
    throw new AppError("COMPLIANCE_BLOCKED", `action '${action}' is not available`, 403);
  }
  return user;
}
