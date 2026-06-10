/** CLI: apply the idempotent schema (works on Postgres via DATABASE_URL, or PGlite). */
import { closeDb, createDb, migrateDb } from "./client.js";

const db = createDb();
await migrateDb(db);
console.log(
  `[db] schema applied (${process.env.DATABASE_URL ? "postgres" : `pglite:${process.env.PGLITE_DIR ?? ".data/pglite"}`})`,
);
await closeDb(db);
