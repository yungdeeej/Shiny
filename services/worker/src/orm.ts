/**
 * Drizzle operator re-export for the worker.
 *
 * pnpm's isolated node_modules means `drizzle-orm` is not a resolvable specifier
 * from services/worker. The query-builder instance comes from @trash-wars/db, so
 * the operators must be the EXACT same physical module (drizzle's instanceof
 * checks break otherwise) — import them via the db package's own copy, exactly
 * like services/api/src/core/orm.ts does.
 */
export {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "../../../packages/db/node_modules/drizzle-orm/index.js";
