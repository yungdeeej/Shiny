/**
 * Drizzle operator re-export.
 *
 * pnpm's isolated node_modules means `drizzle-orm` is not a resolvable specifier from
 * services/api (it's a dependency of @trash-wars/db, not of this package, and adding
 * deps is out of scope). The query-builder *instance* comes from @trash-wars/db, but the
 * operators (eq/and/sql/...) must be the exact same physical module or drizzle's
 * instanceof checks break — so we import them via the db package's own copy.
 */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  not,
  notInArray,
  or,
  sql,
} from "../../../../packages/db/node_modules/drizzle-orm/index.js";
