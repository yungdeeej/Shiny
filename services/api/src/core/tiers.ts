/**
 * Street Cred TierService (v1.1, specs/01).
 *
 * Tiers resolve from the user's primary wallet on-chain $SHINY holding (held,
 * not deposited). Thresholds live in tier_definitions (seeded from the shared
 * TIER_DEFINITIONS; movable ONLY through the 7-day-notice timelock); perks come
 * from the shared contract so client and API can never disagree.
 *
 * Anti-flicker (CRED_POLICY): upgrades apply immediately; downgrades apply only
 * after 24 game-hours below the threshold, tracked via users.tier_grace_*.
 * Holdings are cached in-memory for 5 minutes (CRED_POLICY.holdingCacheMinutes).
 */
import {
  CRED_POLICY,
  TIER_DEFINITIONS,
  TIER_ORDER,
  credTier,
  type CredInfo,
  type CredTier,
  type TierPerks,
} from "@trash-wars/shared";
import { tierDefinitions, tierSnapshots, users, wallets } from "@trash-wars/db";
import { eq } from "./orm.js";
import type { AppContext } from "./context.js";

export interface ResolvedTier {
  tier: CredTier;
  held: bigint;
  wallet: string | null;
  perks: TierPerks;
  /** ISO timestamp the pending downgrade applies (null when no grace running). */
  graceUntil: string | null;
}

interface CacheEntry {
  resolved: ResolvedTier;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test hook: drop cached resolutions (one user or everyone). */
export function invalidateTierCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

function rank(tier: CredTier): number {
  return TIER_ORDER.indexOf(tier);
}

function asTier(value: string | null | undefined): CredTier {
  const parsed = credTier.safeParse(value);
  return parsed.success ? parsed.data : "none";
}

/** Thresholds from tier_definitions (admin-tunable via timelock), shared fallback. */
export async function loadThresholds(ctx: AppContext): Promise<Record<CredTier, bigint>> {
  const rows = await ctx.db.select().from(tierDefinitions);
  const byTier = new Map(rows.map((r) => [r.tier, r.minBalance]));
  const result = {} as Record<CredTier, bigint>;
  for (const tier of TIER_ORDER) {
    result[tier] = byTier.get(tier) ?? TIER_DEFINITIONS[tier].minHeld;
  }
  return result;
}

function tierFor(held: bigint, thresholds: Record<CredTier, bigint>): CredTier {
  let result: CredTier = "none";
  for (const tier of TIER_ORDER) {
    if (held >= thresholds[tier]) result = tier;
  }
  return result;
}

/** The wallet address the holding is read from (beta guests get a stub address). */
async function holdingAddress(ctx: AppContext, userId: string): Promise<string | null> {
  const walletRows = await ctx.db.select().from(wallets).where(eq(wallets.userId, userId));
  const primary = walletRows.find((w) => w.isPrimary) ?? walletRows[0];
  if (primary) return primary.address;
  // Beta: wallet-less guests resolve through the stub provider (BETA_STUB_HOLDING
  // default 50k SHINY → Block) under a per-user address so tests can override.
  return ctx.env.beta ? `guest:${userId}` : null;
}

/**
 * Resolve a user's Street Cred tier. Cached 5 minutes; `force` bypasses the
 * cache (daily snapshot job). Writes users.current_tier + a tier_snapshots row
 * on every real resolution.
 */
export async function resolveTier(
  ctx: AppContext,
  userId: string,
  opts: { force?: boolean; now?: Date } = {},
): Promise<ResolvedTier> {
  const now = opts.now ?? new Date();
  if (!opts.force) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > now.getTime()) return hit.resolved;
  }

  const userRows = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw new Error(`tiers: unknown user ${userId}`);

  const address = await holdingAddress(ctx, userId);
  const held = address === null ? 0n : await ctx.chain.getShinyHolding(address);
  const thresholds = await loadThresholds(ctx);
  const raw = tierFor(held, thresholds);
  const current = asTier(user.currentTier);

  let effective: CredTier = current;
  let graceStartedAt = user.tierGraceStartedAt;
  let graceTarget = asTier(user.tierGraceTarget ?? undefined);
  const graceMs = ctx.clock.gameHoursToMs(CRED_POLICY.downgradeGraceHours);

  if (rank(raw) >= rank(current)) {
    // Upgrades (and re-qualifying during a grace window) apply immediately.
    effective = raw;
    graceStartedAt = null;
    graceTarget = "none";
  } else if (graceStartedAt === null) {
    // First sighting below threshold — start the 24h grace window.
    graceStartedAt = now;
    graceTarget = raw;
  } else if (now.getTime() - graceStartedAt.getTime() >= graceMs) {
    // Grace elapsed — the downgrade lands (to the CURRENT raw tier).
    effective = raw;
    graceStartedAt = null;
    graceTarget = "none";
  } else {
    // Grace still running — keep the old tier, track the latest target.
    graceTarget = raw;
  }

  const graceUntil =
    graceStartedAt !== null ? new Date(graceStartedAt.getTime() + graceMs).toISOString() : null;

  await ctx.db
    .update(users)
    .set({
      currentTier: effective,
      tierGraceStartedAt: graceStartedAt,
      tierGraceTarget: graceStartedAt === null ? null : graceTarget,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  await ctx.db.insert(tierSnapshots).values({
    userId,
    wallet: address,
    balance: held,
    tier: effective,
    snapshottedAt: now,
  });

  const resolved: ResolvedTier = {
    tier: effective,
    held,
    wallet: address,
    perks: { ...TIER_DEFINITIONS[effective].perks },
    graceUntil,
  };
  cache.set(userId, {
    resolved,
    expiresAt: now.getTime() + CRED_POLICY.holdingCacheMinutes * 60_000,
  });
  return resolved;
}

/** The shared credInfo shape for GET /me and /cred (specs/01). */
export async function credInfoFor(ctx: AppContext, userId: string): Promise<CredInfo> {
  const resolved = await resolveTier(ctx, userId);
  const thresholds = await loadThresholds(ctx);
  const i = rank(resolved.tier);
  const next = i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1]! : null;
  const shortfall =
    next === null
      ? null
      : thresholds[next] > resolved.held
        ? thresholds[next] - resolved.held
        : 0n;
  return {
    tier: resolved.tier,
    heldBalance: resolved.held.toString(),
    nextTier: next,
    shortfall: shortfall === null ? null : shortfall.toString(),
    graceUntil: resolved.graceUntil,
    perks: { ...resolved.perks },
  };
}
