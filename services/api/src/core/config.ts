/** config_kv helpers: kill-switch flags, JSON values and bigint-safe counters. */
import type { Db } from "@trash-wars/db";
import { configKv } from "@trash-wars/db";
import { eq, sql } from "./orm.js";

export async function getKv<T = unknown>(db: Db, key: string): Promise<T | undefined> {
  const rows = await db
    .select({ value: configKv.value })
    .from(configKv)
    .where(eq(configKv.key, key))
    .limit(1);
  return rows[0]?.value as T | undefined;
}

export async function setKv(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(configKv)
    .values({ key, value })
    .onConflictDoUpdate({ target: configKv.key, set: { value, updatedAt: new Date() } });
}

export async function getFlag(db: Db, key: string): Promise<boolean> {
  return (await getKv<boolean>(db, key)) === true;
}

/** Counters are stored as JSON strings so they stay bigint-exact. */
export async function getCounter(db: Db, key: string): Promise<bigint> {
  const v = await getKv<string | number>(db, key);
  if (v === undefined) return 0n;
  return BigInt(typeof v === "number" ? Math.trunc(v) : v);
}

/** Atomic add (SQL-side numeric arithmetic) — safe under concurrent settles. */
export async function addToCounter(db: Db, key: string, delta: bigint): Promise<void> {
  await db
    .insert(configKv)
    .values({ key, value: delta.toString() })
    .onConflictDoUpdate({
      target: configKv.key,
      set: {
        value: sql`to_jsonb((((${configKv.value} #>> '{}')::numeric + ${delta.toString()}::numeric))::text)`,
        updatedAt: new Date(),
      },
    });
}
