/** Location config access (zod-validated from the locations table) + live patrol weights. */
import {
  locationConfig,
  type LocationConfig,
} from "@trash-wars/shared";
import { locations, patrols } from "@trash-wars/db";
import { and, eq, gt, sql } from "./orm.js";
import type { AppContext } from "./context.js";
import { notFound } from "./errors.js";

export interface LocationRow {
  slug: string;
  name: string;
  enabled: boolean;
  config: LocationConfig;
}

export function parseLocation(row: { slug: string; name: string; enabled: boolean; config: Record<string, unknown> }): LocationRow {
  const config = locationConfig.parse({ ...row.config, slug: row.slug });
  return { slug: row.slug, name: row.name, enabled: row.enabled, config };
}

export async function listLocations(ctx: AppContext): Promise<LocationRow[]> {
  const rows = await ctx.db.select().from(locations);
  return rows.map(parseLocation);
}

export async function getLocation(ctx: AppContext, slug: string): Promise<LocationRow> {
  const rows = await ctx.db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw notFound(`unknown location ${slug}`);
  return parseLocation(row);
}

/** Sum of active patrol weights at a location (live, shift not yet ended). */
export async function patrolWeightAt(ctx: AppContext, slug: string, now = new Date()): Promise<number> {
  const rows = await ctx.db
    .select({ w: sql<string>`coalesce(sum(${patrols.weight}), 0)::text` })
    .from(patrols)
    .where(and(eq(patrols.locationSlug, slug), eq(patrols.active, true), gt(patrols.shiftEnd, now)));
  return Number(rows[0]?.w ?? "0");
}

/** All active patrols at a location (bounty/bribe routing). */
export async function activePatrolsAt(ctx: AppContext, slug: string, now = new Date()) {
  return ctx.db
    .select()
    .from(patrols)
    .where(and(eq(patrols.locationSlug, slug), eq(patrols.active, true), gt(patrols.shiftEnd, now)));
}
