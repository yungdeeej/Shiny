/**
 * drizzle-kit config — kept for future use (introspection / generated migrations once we
 * move beyond the beta's single-file SCHEMA_SQL approach). The live migration path is
 * `migrateDb()` in src/client.ts, which executes src/sql.ts idempotently and works on both
 * node-postgres and PGlite.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trash_wars",
  },
});
