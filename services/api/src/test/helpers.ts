/** Shared test harness: in-memory PGlite app, guest sessions, ledger assertions. */
import type { FastifyInstance, InjectOptions } from "fastify";
import { resolveMission, rollFromSeeds } from "@trash-wars/economy";
import type { MissionOutcome, ProbabilityTable } from "@trash-wars/shared";
import { ledgerEntries, missions, accounts } from "@trash-wars/db";
import { eq, sql } from "../core/orm.js";
import { decryptSecret } from "../core/crypto.js";
import { build, type BuildOptions } from "../server.js";

export const TEST_SEED_KEY = "test-seed-key";

export async function buildTestApp(
  extraEnv: Record<string, string> = {},
  opts: Omit<BuildOptions, "env" | "beta"> = {},
): Promise<FastifyInstance> {
  process.env.PGLITE_DIR = "memory://";
  return build({
    beta: true,
    env: {
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      LOG_LEVEL: "silent",
      BETA_TIME_SCALE: "100000",
      RATE_LIMIT_MAX: "1000000",
      SERVER_SEED_ENCRYPTION_KEY: TEST_SEED_KEY,
      ...extraEnv,
    },
    ...opts,
  });
}

export interface TestSession {
  userId: string;
  handle: string;
  cookies: Record<string, string>;
}

export async function guest(app: FastifyInstance, handle: string): Promise<TestSession> {
  const res = await app.inject({ method: "POST", url: "/auth/guest", payload: { handle } });
  if (res.statusCode !== 200) throw new Error(`guest signup failed: ${res.body}`);
  const cookie = res.cookies[0]!;
  return { userId: res.json().userId, handle, cookies: { [cookie.name]: cookie.value } };
}

export function as(session: TestSession, opts: InjectOptions): InjectOptions {
  return { ...opts, cookies: session.cookies };
}

/** Conservation invariant: every ledger entry summed must be exactly zero. */
export async function ledgerTotal(app: FastifyInstance): Promise<bigint> {
  const rows = await app.ctx.db
    .select({ v: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)::text` })
    .from(ledgerEntries);
  return BigInt(rows[0]?.v ?? "0");
}

export async function systemBalance(
  app: FastifyInstance,
  kind: keyof typeof app.ctx.accounts,
): Promise<bigint> {
  return app.ctx.ledger.getBalance(app.ctx.accounts[kind]);
}

export async function userBalance(app: FastifyInstance, userId: string): Promise<bigint> {
  const account = await app.ctx.ledger.ensureAccount("user", userId, "game_balance");
  return app.ctx.ledger.getBalance(account);
}

/** Force a mission due (lazy settlement picks it up). */
export async function forceDue(app: FastifyInstance, missionId: string): Promise<void> {
  await app.ctx.db
    .update(missions)
    .set({ resolvesAt: new Date(Date.now() - 1000) })
    .where(eq(missions.id, missionId));
}

/** Reveal a mission's committed server seed straight from the database. */
export async function peekServerSeed(app: FastifyInstance, missionId: string): Promise<string> {
  const rows = await app.ctx.db
    .select({ enc: missions.serverSeedEnc })
    .from(missions)
    .where(eq(missions.id, missionId))
    .limit(1);
  return decryptSecret(rows[0]!.enc!, TEST_SEED_KEY);
}

/**
 * Deterministically force an outcome: search a clientSeed whose roll lands in the
 * target band of the persisted table, then persist it before settlement.
 */
export function findClientSeed(
  serverSeed: string,
  missionId: string,
  table: ProbabilityTable,
  target: MissionOutcome,
): string {
  for (let i = 0; i < 200_000; i++) {
    const candidate = `force-${i}`;
    const roll = rollFromSeeds(serverSeed, candidate, missionId);
    if (resolveMission(table, roll).outcome === target) return candidate;
  }
  throw new Error(`no clientSeed found for outcome ${target}`);
}

export async function setClientSeed(
  app: FastifyInstance,
  missionId: string,
  clientSeed: string,
): Promise<void> {
  await app.ctx.db.update(missions).set({ clientSeed }).where(eq(missions.id, missionId));
}

/** Start a mission via API + force the given outcome; returns missionId. */
export async function startMissionForced(
  app: FastifyInstance,
  session: TestSession,
  payload: { locationSlug: string; characterId?: string; stake: string },
  outcome: MissionOutcome,
): Promise<{ missionId: string; effectiveTable: ProbabilityTable }> {
  const res = await app.inject(
    as(session, { method: "POST", url: "/game/missions", payload }),
  );
  if (res.statusCode !== 200) throw new Error(`mission start failed: ${res.body}`);
  const mission = res.json();
  const serverSeed = await peekServerSeed(app, mission.id);
  const clientSeed = findClientSeed(serverSeed, mission.id, mission.effectiveTable, outcome);
  await setClientSeed(app, mission.id, clientSeed);
  await forceDue(app, mission.id);
  return { missionId: mission.id, effectiveTable: mission.effectiveTable };
}

export async function escrowIsEmpty(app: FastifyInstance): Promise<boolean> {
  return (await systemBalance(app, "mission_escrow")) === 0n;
}

export { accounts };
