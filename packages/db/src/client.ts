/**
 * Database client factory. Two modes, zero docker required for the beta:
 *
 *  - DATABASE_URL (or opts.connectionString) set → node-postgres Pool.
 *  - otherwise → embedded PGlite persisted at .data/pglite
 *    (override with PGLITE_DIR; use "memory://" for tests).
 */
import { mkdirSync } from "node:fs";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema.js";
import { SCHEMA_STATEMENTS } from "./sql.js";

/**
 * Common database type both drivers satisfy. Pragmatic `any` on the query-result HKT so the
 * node-postgres and PGlite drizzle instances unify; the full typed schema is preserved for
 * the query builder, which is what callers actually use.
 */
export type Db = PgDatabase<any, typeof schema>;

export interface CreateDbOptions {
  connectionString?: string;
}

export function createDb(opts: CreateDbOptions = {}): Db {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (connectionString) {
    const pool = new pg.Pool({ connectionString });
    return drizzleNode(pool, { schema });
  }
  const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (!dataDir.startsWith("memory://")) {
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);
  return drizzlePglite(client, { schema });
}

/** Gracefully shut down the underlying Pool / PGlite instance. */
export async function closeDb(db: Db): Promise<void> {
  const client = (db as unknown as { $client?: unknown }).$client;
  if (client instanceof PGlite) {
    await client.close();
  } else if (client instanceof pg.Pool) {
    await client.end();
  }
}

/**
 * Applies the full schema idempotently (safe to run on every boot, on either driver).
 * Statements are executed one at a time because PGlite's query protocol is single-statement.
 */
export async function migrateDb(db: Db): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
}
