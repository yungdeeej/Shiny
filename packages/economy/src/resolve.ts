/**
 * Pure mission-resolution math. Imported by the live backend AND the in-browser
 * demo client — keep this file free of node-only APIs and side effects.
 *
 * All money is bigint base units (6 decimals). Probabilities and multipliers are
 * integer basis points; tables always sum to exactly 10_000 bps.
 */
import {
  HEAT_THRESHOLDS,
  POLICY,
  SHINY_UNIT,
  SINKS,
  STAT_EFFECTS,
  applyBps,
  toBaseUnits,
  type CharacterStats,
  type HeatBand,
  type LocationConfig,
  type OutcomeRow,
  type ProbabilityTable,
} from "@trash-wars/shared";

const PAYING = new Set<string>(["win", "jackpot"]);
/** Paying rows are never squeezed below this by patrol pressure. */
const PAYING_FLOOR_BPS = 100;

function cloneTable(table: ProbabilityTable): ProbabilityTable {
  return table.map((row) => ({ ...row }));
}

function findRow(table: ProbabilityTable, outcome: OutcomeRow["outcome"]): OutcomeRow | undefined {
  return table.find((row) => row.outcome === outcome);
}

function assertBalanced(table: ProbabilityTable, context: string): ProbabilityTable {
  let sum = 0;
  for (const row of table) {
    if (row.probabilityBps < 0 || !Number.isInteger(row.probabilityBps)) {
      throw new Error(`${context}: invalid probabilityBps ${row.probabilityBps} on ${row.outcome}`);
    }
    sum += row.probabilityBps;
  }
  if (sum !== 10_000) throw new Error(`${context}: table sums to ${sum} bps, expected 10000`);
  return table;
}

/**
 * Apply a character's stats to a table (STAT_EFFECTS from shared):
 * - stealth: −150 bps arrest per level (floored at 0); the reduction moves into `nothing`.
 * - luck:    +30 bps jackpot per level, moved out of `nothing` (only if the table has a jackpot row).
 * - muscle:  win/jackpot multiplierBps grow by min(muscle*200, 2000) bps-of-multiplier,
 *            i.e. multiplierBps += floor(multiplierBps * bonus / 10000) — pure integer math.
 * The result always sums to exactly 10_000 bps.
 */
export function applyStatModifiers(table: ProbabilityTable, stats: CharacterStats): ProbabilityTable {
  const rows = cloneTable(table);
  const nothing = findRow(rows, "nothing");
  const arrest = findRow(rows, "arrest");

  if (arrest && nothing && stats.stealth > 0) {
    const reduction = Math.min(
      arrest.probabilityBps,
      stats.stealth * STAT_EFFECTS.stealthArrestReductionBpsPerLevel,
    );
    arrest.probabilityBps -= reduction;
    nothing.probabilityBps += reduction;
  }

  const jackpot = findRow(rows, "jackpot");
  if (jackpot && nothing && stats.luck > 0) {
    const shift = Math.min(nothing.probabilityBps, stats.luck * STAT_EFFECTS.luckJackpotBpsPerLevel);
    nothing.probabilityBps -= shift;
    jackpot.probabilityBps += shift;
  }

  const bonusBps = Math.min(
    stats.muscle * STAT_EFFECTS.muscleMultiplierBpsPerLevel,
    STAT_EFFECTS.muscleMultiplierCapBps,
  );
  if (bonusBps > 0) {
    for (const row of rows) {
      if (PAYING.has(row.outcome) && row.multiplierBps !== undefined) {
        row.multiplierBps += Math.floor((row.multiplierBps * bonusBps) / 10_000);
      }
    }
  }

  return assertBalanced(rows, "applyStatModifiers");
}

export interface PatrolCaps {
  capArrestShiftBps: number;
  capConfShiftBps: number;
}

/**
 * Apply Bloodhound patrol pressure to a table:
 * - arrest       += min(floor(weight*80), capArrestShiftBps)
 * - confiscation += min(floor(weight*60), capConfShiftBps) (row added if the table lacks one)
 * The total added is removed from paying rows (win/jackpot) proportionally, never
 * pushing a paying row below 100 bps; any unabsorbed remainder comes out of
 * `nothing`, and as a last resort the patrol additions themselves are rolled back
 * so the table always sums to exactly 10_000 bps.
 */
export function applyPatrolModifiers(
  table: ProbabilityTable,
  patrolWeight: number,
  caps: PatrolCaps,
): ProbabilityTable {
  const rows = cloneTable(table);
  const weight = Math.max(0, patrolWeight);

  const arrest = findRow(rows, "arrest");
  const arrestAdd = arrest
    ? Math.min(Math.floor(weight * STAT_EFFECTS.patrolArrestBpsPerWeight), caps.capArrestShiftBps)
    : 0;
  const confAdd = Math.min(Math.floor(weight * STAT_EFFECTS.patrolConfBpsPerWeight), caps.capConfShiftBps);

  if (arrest) arrest.probabilityBps += arrestAdd;
  let conf = findRow(rows, "confiscation");
  if (confAdd > 0) {
    if (conf) {
      conf.probabilityBps += confAdd;
    } else {
      conf = { outcome: "confiscation", probabilityBps: confAdd };
      rows.push(conf);
    }
  }

  let remaining = arrestAdd + (confAdd > 0 ? confAdd : 0);
  if (remaining === 0) return assertBalanced(rows, "applyPatrolModifiers");
  const totalAdded = remaining;

  const paying = rows.filter((row) => PAYING.has(row.outcome));
  const payingTotal = paying.reduce((s, row) => s + row.probabilityBps, 0);
  if (payingTotal > 0) {
    // first pass: proportional cut
    for (const row of paying) {
      const target = Math.floor((totalAdded * row.probabilityBps) / payingTotal);
      const cut = Math.max(0, Math.min(target, row.probabilityBps - PAYING_FLOOR_BPS, remaining));
      row.probabilityBps -= cut;
      remaining -= cut;
    }
    // second pass: mop up integer-rounding remainder, still respecting the floor
    for (const row of paying) {
      if (remaining === 0) break;
      const cut = Math.max(0, Math.min(row.probabilityBps - PAYING_FLOOR_BPS, remaining));
      row.probabilityBps -= cut;
      remaining -= cut;
    }
  }

  const nothing = findRow(rows, "nothing");
  if (remaining > 0 && nothing) {
    const cut = Math.min(nothing.probabilityBps, remaining);
    nothing.probabilityBps -= cut;
    remaining -= cut;
  }

  // Nothing left to take from — roll the patrol additions back so the table balances.
  if (remaining > 0 && arrest) {
    const back = Math.min(arrestAdd, remaining);
    arrest.probabilityBps -= back;
    remaining -= back;
  }
  if (remaining > 0 && conf) {
    const back = Math.min(confAdd, remaining);
    conf.probabilityBps -= back;
    remaining -= back;
  }

  return assertBalanced(rows, "applyPatrolModifiers");
}

/**
 * Bribe the patrol: remove 50% of the patrol-added arrest/confiscation delta,
 * computed by diffing `table` (post-patrol) against `baseTable` (pre-patrol).
 * The refunded bps are returned to paying rows proportionally (the mirror of the
 * patrol cut); integer-rounding leftover lands in `nothing`. Sums stay 10_000.
 */
export function applyBribe(table: ProbabilityTable, baseTable: ProbabilityTable): ProbabilityTable {
  const rows = cloneTable(table);
  const baseArrest = findRow(baseTable, "arrest")?.probabilityBps ?? 0;
  const baseConf = findRow(baseTable, "confiscation")?.probabilityBps ?? 0;
  const arrest = findRow(rows, "arrest");
  const conf = findRow(rows, "confiscation");

  const refundArrest = arrest ? Math.floor(Math.max(0, arrest.probabilityBps - baseArrest) / 2) : 0;
  const refundConf = conf ? Math.floor(Math.max(0, conf.probabilityBps - baseConf) / 2) : 0;
  if (arrest) arrest.probabilityBps -= refundArrest;
  if (conf) conf.probabilityBps -= refundConf;

  const refund = refundArrest + refundConf;
  if (refund === 0) return assertBalanced(rows, "applyBribe");

  const paying = rows.filter((row) => PAYING.has(row.outcome));
  const payingTotal = paying.reduce((s, row) => s + row.probabilityBps, 0);
  let given = 0;
  if (payingTotal > 0) {
    for (const row of paying) {
      const add = Math.floor((refund * row.probabilityBps) / payingTotal);
      row.probabilityBps += add;
      given += add;
    }
  }
  const leftover = refund - given;
  if (leftover > 0) {
    const nothing = findRow(rows, "nothing");
    const first = paying[0];
    if (nothing) nothing.probabilityBps += leftover;
    else if (first) first.probabilityBps += leftover;
    else if (arrest) arrest.probabilityBps += leftover;
  }

  return assertBalanced(rows, "applyBribe");
}

/**
 * Resolve a roll in [0,1) against a table: walk cumulative probabilityBps over
 * floor(roll * 10000) and return the matching row.
 */
export function resolveMission(table: ProbabilityTable, roll: number): OutcomeRow {
  if (!(roll >= 0 && roll < 1)) throw new Error(`roll out of range [0,1): ${roll}`);
  const target = Math.min(9_999, Math.floor(roll * 10_000));
  let cumulative = 0;
  for (const row of table) {
    cumulative += row.probabilityBps;
    if (target < cumulative) return row;
  }
  const last = table[table.length - 1];
  if (!last) throw new Error("resolveMission: empty table");
  return last;
}

/**
 * Payout for a resolved row:
 * - win/jackpot: stake * multiplierBps / 10000 (bigint floor)
 * - nothing/arrest: the stake is returned
 * - confiscation/rekt_*: 0 (the stake is lost — routed 50/50 burn/PD by the caller)
 */
export function computePayout(stake: bigint, row: OutcomeRow): bigint {
  switch (row.outcome) {
    case "win":
    case "jackpot":
      return (stake * BigInt(row.multiplierBps ?? 10_000)) / 10_000n;
    case "nothing":
    case "arrest":
      return stake;
    case "confiscation":
    case "rekt_items":
    case "rekt_character":
      return 0n;
  }
}

/**
 * Doc-01 EV convention: expected payout from PAYING rows only, in bps of stake
 * (Corner Store: 0.70 * 1.4x = 9800). Stake returned on nothing/arrest is treated
 * as principal, not payout — use computePayoutEvBps for the full expectation.
 */
export function computeEvBps(table: ProbabilityTable): number {
  let acc = 0;
  for (const row of table) {
    if (PAYING.has(row.outcome) && row.multiplierBps !== undefined) {
      acc += row.probabilityBps * row.multiplierBps;
    }
  }
  return Math.round(acc / 10_000);
}

/**
 * Full expected payout in bps of stake, where nothing/arrest contribute 10000 bps
 * each (stake returned) and confiscation/rekt contribute 0.
 */
export function computePayoutEvBps(table: ProbabilityTable): number {
  let acc = 0;
  for (const row of table) {
    if (PAYING.has(row.outcome)) acc += row.probabilityBps * (row.multiplierBps ?? 10_000);
    else if (row.outcome === "nothing" || row.outcome === "arrest") acc += row.probabilityBps * 10_000;
  }
  return Math.round(acc / 10_000);
}

/**
 * Expected EMISSION cost of one mission, in bps of stake: only the winnings above
 * the returned stake are paid from the season budget. Used by the season invariant.
 */
export function computeEmissionCostBps(table: ProbabilityTable): number {
  let acc = 0;
  for (const row of table) {
    if (PAYING.has(row.outcome) && row.multiplierBps !== undefined) {
      acc += row.probabilityBps * Math.max(0, row.multiplierBps - 10_000);
    }
  }
  return Math.round(acc / 10_000);
}

/**
 * Cost of the next stat upgrade given the number of upgrades already bought
 * (`currentLevel` = 0 for the first one): 500 * 1.35^level whole SHINY.
 * Determinism note: the exponential is computed in Number space, rounded to a
 * whole SHINY with Math.round, then converted with toBaseUnits — identical on
 * every JS engine for the level range we allow (IEEE-754 double, level <= ~60).
 */
export function upgradeCost(currentLevel: number): bigint {
  const level = Math.max(0, Math.floor(currentLevel));
  const baseWhole = Number(SINKS.statUpgradeBase / SHINY_UNIT); // 500
  const whole = Math.round(baseWhole * Math.pow(SINKS.statUpgradeGrowth, level));
  return toBaseUnits(whole);
}

/**
 * Idle rate per hour at a location for a character level (level >= 1):
 * base * (10 + (level - 1)) / 10 — i.e. +10% per level above 1, bigint math.
 */
export function idleRatePerHour(location: LocationConfig, level: number): bigint {
  const lvl = Math.max(1, Math.floor(level));
  return (BigInt(location.idleRatePerHour) * BigInt(10 + (lvl - 1))) / 10n;
}

/** Pre-mission rekt insurance premium: stake * insuranceBps. */
export function insurancePrice(stake: bigint, location: LocationConfig): bigint {
  return applyBps(stake, location.insuranceBps);
}

/** Flat jail-skip price (SINKS.jailBail). */
export function bailPrice(): bigint {
  return SINKS.jailBail;
}

/** Withdrawal tax (the rake): amount * POLICY.withdrawalFeeBps. */
export function withdrawalTax(amount: bigint): bigint {
  return applyBps(amount, POLICY.withdrawalFeeBps);
}

/** Raffle ticket price (SINKS.raffleTicket). */
export function raffleTicketPrice(): bigint {
  return SINKS.raffleTicket;
}

/** Character mint price by faction (bloodhound is the premium PD mint). */
export function mintPrice(faction: "raccoon" | "bloodhound"): bigint {
  return faction === "raccoon" ? SINKS.mintRaccoon : SINKS.mintBloodhound;
}

/**
 * Split a lost mission stake 50/50 burn/PD pool (POLICY.lossSplit).
 * Conservation-safe: pd takes the exact remainder after the bps floor on burn.
 */
export function splitLoss(amount: bigint): { burn: bigint; pd: bigint } {
  const burn = applyBps(amount, POLICY.lossSplit.burnBps);
  return { burn, pd: amount - burn };
}

/** Split a bail payment 75% burn / 25% PD pool (POLICY.bailSplit), conservation-safe. */
export function splitBail(amount: bigint): { burn: bigint; pd: bigint } {
  const burn = applyBps(amount, POLICY.bailSplit.burnBps);
  return { burn, pd: amount - burn };
}

/** Map an aggregate patrol weight to the public heat band (HEAT_THRESHOLDS). */
export function heatBandForWeight(weight: number): HeatBand {
  for (const threshold of HEAT_THRESHOLDS) {
    if (weight <= threshold.max) return threshold.band;
  }
  return "blazing";
}
