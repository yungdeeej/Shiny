/**
 * Agent-based S1 economy simulator (doc 01). Pure & deterministic: no node APIs,
 * single seeded RNG, missions resolved through the SAME resolveMission /
 * rollFromSeeds primitives the live game uses.
 *
 * Conservation invariant, asserted at the end of every simulated day:
 *   deposited + emissionsSpent === Σ playerBalances + burned + pdPool + treasury + withdrawn
 */
import {
  POLICY,
  SINKS,
  applyBps,
  toBaseUnits,
  type CharacterStats,
  type ProbabilityTable,
} from "@trash-wars/shared";
import { SEASON1, SEASON1_LOCATIONS } from "../config/season1.js";
import { generateServerSeed, makeRng, rollFromSeeds } from "../rng.js";
import {
  applyPatrolModifiers,
  applyStatModifiers,
  computePayout,
  idleRatePerHour,
  insurancePrice,
  resolveMission,
  splitBail,
  splitLoss,
  upgradeCost,
} from "../resolve.js";
import type { Archetype, DauCurve, DayRow, SimOptions, SimResult } from "./types.js";

/** PD (Bloodhound) activation day per doc 01: "Raccoons only → PD activates T+30". */
export const PD_ACTIVATION_DAY = 30;

const DEFAULT_MIX: Record<Archetype, number> = {
  grinder: 0.35,
  extractor: 0.2,
  whale: 0.05,
  tourist: 0.3,
  pd_farmer: 0.1,
};

interface ArchetypeProfile {
  bankroll: bigint;
  missionsPerDay: number;
  rotation: readonly string[];
  charactersAtStart: number;
  /** stake = balance / stakeDivisor, clamped to the location's min/max. */
  stakeDivisor: bigint;
  upgrades: keyof CharacterStats | null;
}

const PROFILES: Record<Archetype, ArchetypeProfile> = {
  grinder: {
    bankroll: toBaseUnits(5_000),
    missionsPerDay: 3,
    rotation: ["corner-store", "pawn-shop"],
    charactersAtStart: 1,
    stakeDivisor: 5n,
    upgrades: "stealth",
  },
  extractor: {
    bankroll: toBaseUnits(10_000),
    missionsPerDay: 2,
    rotation: ["pawn-shop", "jewelry-district"],
    charactersAtStart: 1,
    stakeDivisor: 4n,
    upgrades: null,
  },
  whale: {
    bankroll: toBaseUnits(200_000),
    missionsPerDay: 10, // one per character
    rotation: ["armored-truck", "first-national", "the-mint"],
    charactersAtStart: 10,
    stakeDivisor: 20n,
    upgrades: "muscle",
  },
  tourist: {
    bankroll: toBaseUnits(12_000),
    missionsPerDay: 2, // free tier: 1 per 8h, ~2 in an active stretch
    rotation: ["corner-store"],
    charactersAtStart: 0,
    stakeDivisor: 10n, // free tier stake = min(holding * 0.1, 5k)
    upgrades: null,
  },
  pd_farmer: {
    bankroll: toBaseUnits(10_000),
    missionsPerDay: 0, // patrol-only; yield comes from the PD pool
    rotation: [],
    charactersAtStart: 1,
    stakeDivisor: 1n,
    upgrades: null,
  },
};

interface SimPlayer {
  id: string;
  archetype: Archetype;
  balance: bigint;
  characters: number;
  level: number;
  stats: CharacterStats;
  jailedUntilDay: number;
  onboarded: boolean;
  activeDays: number;
  converted: boolean; // tourist -> minted grinder
  conversionDecided: boolean;
}

function dauAt(curve: DauCurve, day: number, players: number): number {
  let frac: number;
  switch (curve) {
    case "growth":
      frac = Math.min(1, 0.15 + (0.85 * day) / 60);
      break;
    case "plateau":
      frac = 0.6;
      break;
    case "decay":
      frac = Math.max(0.1, 0.9 * Math.pow(0.985, day));
      break;
  }
  return Math.max(1, Math.min(players, Math.round(players * frac)));
}

/** Golden-ratio low-discrepancy assignment so every DAU prefix matches the mix. */
function assignArchetype(index: number, mix: Record<Archetype, number>): Archetype {
  const u = (index * 0.6180339887498949) % 1;
  const total = Object.values(mix).reduce((s, v) => s + v, 0);
  let cumulative = 0;
  for (const key of Object.keys(mix) as Archetype[]) {
    cumulative += mix[key] / total;
    if (u < cumulative) return key;
  }
  return "grinder";
}

export function runSim(options: SimOptions): SimResult {
  const mix: Record<Archetype, number> = { ...DEFAULT_MIX, ...options.mix };
  const rng = makeRng(options.seed);
  const locBySlug = new Map(SEASON1_LOCATIONS.map((loc) => [loc.slug, loc]));

  const players: SimPlayer[] = [];
  for (let i = 0; i < options.players; i++) {
    players.push({
      id: `p${i}`,
      archetype: assignArchetype(i, mix),
      balance: 0n,
      characters: 0,
      level: 1,
      stats: { stealth: 0, muscle: 0, luck: 0, reputation: 0 },
      jailedUntilDay: -1,
      onboarded: false,
      activeDays: 0,
      converted: false,
      conversionDecided: false,
    });
  }

  const ledger = {
    deposited: 0n,
    emissionsSpent: 0n,
    burned: 0n,
    pdPool: 0n,
    treasury: 0n,
    withdrawn: 0n,
  };
  let emissionsRemaining = SEASON1.emissions;

  const deposit = (p: SimPlayer, amount: bigint): void => {
    p.balance += amount;
    ledger.deposited += amount;
  };
  const burn = (p: SimPlayer, amount: bigint): void => {
    p.balance -= amount;
    ledger.burned += amount;
  };

  const rows: DayRow[] = [];
  const notes: string[] = [];
  let firstShortfallDay = -1;
  let exhaustedDay = -1;

  for (let day = 0; day < options.days; day++) {
    const dau = dauAt(options.dauCurve, day, options.players);
    const active = players.slice(0, dau);
    const pdActive = day >= PD_ACTIVATION_DAY;

    const dayBudget = SEASON1.dailyBudget <= emissionsRemaining ? SEASON1.dailyBudget : emissionsRemaining;
    let spent = 0n;
    let shortfall = false;
    const payFromBudget = (amount: bigint): bigint => {
      const room = dayBudget - spent;
      const pay = amount <= room ? amount : room;
      if (pay < amount) shortfall = true;
      spent += pay;
      return pay;
    };

    const burnedAtStart = ledger.burned;
    const treasuryAtStart = ledger.treasury;
    let winExcess = 0n;
    let idlePaid = 0n;
    let missions = 0;
    let arrests = 0;
    let confiscations = 0;
    let rekts = 0;

    // ── Patrol pressure: active bloodhounds spread evenly across locations ──
    const activeFarmers = pdActive ? active.filter((p) => p.archetype === "pd_farmer") : [];
    const patrolWeightPerLoc =
      activeFarmers.length > 0 ? activeFarmers.length / SEASON1_LOCATIONS.length : 0;
    const effTables = new Map<string, ProbabilityTable>();
    for (const loc of SEASON1_LOCATIONS) {
      const weight = Math.min(loc.patrolWeightCap, patrolWeightPerLoc);
      effTables.set(loc.slug, weight > 0 ? applyPatrolModifiers(loc.table, weight, loc) : loc.table);
    }

    // ── Player day loop ──────────────────────────────────────────────────
    for (const p of active) {
      p.activeDays += 1;
      let toppedUpToday = false;

      if (!p.onboarded) {
        const profile = PROFILES[p.archetype];
        if (p.archetype === "pd_farmer") {
          if (!pdActive) continue; // bloodhounds don't exist yet
          deposit(p, profile.bankroll + SINKS.mintBloodhound);
          burn(p, SINKS.mintBloodhound);
          p.characters = 1;
        } else {
          const mintCost = SINKS.mintRaccoon * BigInt(profile.charactersAtStart);
          deposit(p, profile.bankroll + mintCost);
          if (mintCost > 0n) burn(p, mintCost);
          p.characters = profile.charactersAtStart;
        }
        p.onboarded = true;
      }

      // tourist conversion: after 7 active days, 20% mint a raccoon and grind
      if (p.archetype === "tourist" && !p.conversionDecided && p.activeDays >= 7) {
        p.conversionDecided = true;
        if (rng() < 0.2) {
          p.converted = true;
          deposit(p, SINKS.mintRaccoon + toBaseUnits(5_000));
          burn(p, SINKS.mintRaccoon);
          p.characters = 1;
        }
      }

      if (p.jailedUntilDay > day) continue; // sitting out a jail day
      if (p.archetype === "pd_farmer") continue; // patrol only

      const behavesAs: Archetype = p.converted ? "grinder" : p.archetype;
      const profile = PROFILES[behavesAs];
      const isFreeTier = behavesAs === "tourist";
      const missionsToday = behavesAs === "whale" ? p.characters : profile.missionsPerDay;
      if (profile.rotation.length === 0) continue;

      let jailedNow = false;
      for (let m = 0; m < missionsToday && !jailedNow; m++) {
        const slug = profile.rotation[(p.activeDays + m) % profile.rotation.length];
        if (slug === undefined) break;
        const loc = locBySlug.get(slug);
        if (!loc) throw new Error(`unknown location ${slug}`);

        if (isFreeTier && p.balance < POLICY.freeTierMinHolding) break;

        let stake = p.balance / profile.stakeDivisor;
        if (isFreeTier && stake > POLICY.freeTierMaxStake) stake = POLICY.freeTierMaxStake;
        const minStake = BigInt(loc.minStake);
        const maxStake = BigInt(loc.maxStake);
        if (stake < minStake) stake = minStake;
        if (stake > maxStake) stake = maxStake;
        if (stake > p.balance) {
          if (!isFreeTier && !toppedUpToday) {
            deposit(p, profile.bankroll); // re-buy working capital, once per day
            toppedUpToday = true;
          }
          if (stake > p.balance) break;
        }
        p.balance -= stake;

        // whales always insure rekt-capable runs (premium is a burn sink)
        let insured = false;
        if (loc.rektCapable && behavesAs === "whale" && loc.insuranceBps > 0) {
          const fee = insurancePrice(stake, loc);
          if (fee <= p.balance) {
            burn(p, fee);
            insured = true;
          }
        }

        const effTable = effTables.get(slug);
        if (!effTable) throw new Error(`missing table for ${slug}`);
        const table = applyStatModifiers(effTable, p.stats);
        const serverSeed = generateServerSeed(rng);
        const roll = rollFromSeeds(serverSeed, p.id, `d${day}:${p.id}:m${m}`);
        const row = resolveMission(table, roll);
        const payout = computePayout(stake, row);
        missions += 1;

        switch (row.outcome) {
          case "win":
          case "jackpot": {
            const paid = payFromBudget(payout - stake); // winnings above stake come from emissions
            p.balance += stake + paid;
            winExcess += paid;
            break;
          }
          case "nothing":
            p.balance += stake;
            break;
          case "arrest": {
            p.balance += stake;
            arrests += 1;
            if (p.balance >= SINKS.jailBail * 4n) {
              const { burn: b, pd } = splitBail(SINKS.jailBail);
              p.balance -= SINKS.jailBail;
              ledger.burned += b;
              ledger.pdPool += pd;
            } else {
              p.jailedUntilDay = day + 2; // rest of today + 24h
              jailedNow = true;
            }
            break;
          }
          case "confiscation":
          case "rekt_items":
          case "rekt_character": {
            const { burn: b, pd } = splitLoss(stake);
            ledger.burned += b;
            ledger.pdPool += pd;
            if (row.outcome === "confiscation") confiscations += 1;
            else rekts += 1;
            if (row.outcome === "rekt_character" && !insured && p.characters > 0) {
              p.characters -= 1;
            }
            break;
          }
        }

        // idle accrual for the character that ran this mission (rest of the day)
        if (!isFreeTier && p.characters > 0 && !jailedNow) {
          const idleHours = Math.max(0, 24 - Math.ceil(loc.durationHours));
          if (idleHours > 0) {
            const accrued = idleRatePerHour(loc, p.level) * BigInt(idleHours);
            const paid = payFromBudget(accrued);
            p.balance += paid;
            idlePaid += paid;
          }
        }
      }

      // rekt to zero characters: re-mint a raccoon next chance (burn sink)
      if (!isFreeTier && p.onboarded && p.characters === 0) {
        if (p.balance < SINKS.mintRaccoon) deposit(p, SINKS.mintRaccoon + profile.bankroll);
        burn(p, SINKS.mintRaccoon);
        p.characters = 1;
      }

      // stat upgrades (grinders: stealth, whales: muscle) — 100% burn
      if (profile.upgrades && p.level < POLICY.statLevelCapS1) {
        const cost = upgradeCost(p.level - 1);
        if (p.balance > cost * 5n) {
          burn(p, cost);
          p.level += 1;
          p.stats[profile.upgrades] += 1;
        }
      }

      // withdrawals (rake): extractors continuously, whales weekly
      let withdrawAmount = 0n;
      if (behavesAs === "extractor") {
        const excess = p.balance - profile.bankroll;
        if (excess >= POLICY.minWithdrawal) withdrawAmount = (excess * 4n) / 5n; // 80% of profit
      } else if (behavesAs === "whale" && day % 7 === 6) {
        const excess = p.balance - profile.bankroll;
        if (excess >= POLICY.minWithdrawal) withdrawAmount = excess / 2n;
      }
      if (withdrawAmount > 0n) {
        const tax = applyBps(withdrawAmount, POLICY.withdrawalFeeBps);
        p.balance -= withdrawAmount;
        ledger.treasury += tax;
        ledger.withdrawn += withdrawAmount - tax;
      }
    }

    // ── PD pool daily distribution (80% of pool, pro-rata to bloodhounds) ──
    let pdDistributed = 0n;
    const farmers = activeFarmers.filter((p) => p.onboarded && p.characters > 0);
    if (pdActive && farmers.length > 0 && ledger.pdPool > 0n) {
      const distributable = applyBps(ledger.pdPool, POLICY.pdDailyDistributionBps);
      const share = distributable / BigInt(farmers.length);
      if (share > 0n) {
        for (const f of farmers) f.balance += share;
        pdDistributed = share * BigInt(farmers.length);
        ledger.pdPool -= pdDistributed;
      }
    }

    ledger.emissionsSpent += spent;
    emissionsRemaining -= spent;
    if (shortfall && firstShortfallDay === -1) firstShortfallDay = day;
    if (emissionsRemaining === 0n && exhaustedDay === -1) exhaustedDay = day;

    // ── Conservation assertion (exact bigint identity, every day) ────────
    let playerBalances = 0n;
    for (const p of players) playerBalances += p.balance;
    const lhs = ledger.deposited + ledger.emissionsSpent;
    const rhs = playerBalances + ledger.burned + ledger.pdPool + ledger.treasury + ledger.withdrawn;
    if (lhs !== rhs) {
      throw new Error(`conservation violated on day ${day}: in=${lhs} accounted=${rhs} diff=${lhs - rhs}`);
    }

    const dailyBurned = ledger.burned - burnedAtStart;
    const dailyRake = ledger.treasury - treasuryAtStart;
    const circulating = ledger.deposited + ledger.emissionsSpent - ledger.burned;
    const gross = winExcess + idlePaid + pdDistributed;
    const farmerCapital = BigInt(farmers.length) * SINKS.mintBloodhound;

    rows.push({
      day,
      dau,
      ...ledger,
      playerBalances,
      emissionsRemaining,
      circulating,
      dailyEmissions: spent,
      dailyBurned,
      dailyRake,
      dailyPdDistributed: pdDistributed,
      dailyWinExcess: winExcess,
      dailyIdle: idlePaid,
      missions,
      arrests,
      confiscations,
      rekts,
      budgetShortfall: shortfall,
      netInflationBps: circulating > 0n ? Number(((spent - dailyBurned) * 10_000n) / circulating) : 0,
      redistributionShareBps: gross > 0n ? Number((pdDistributed * 10_000n) / gross) : 0,
      pdAprBps: farmerCapital > 0n ? Number((pdDistributed * 365n * 10_000n) / farmerCapital) : 0,
    });
  }

  if (firstShortfallDay >= 0) {
    notes.push(
      `Budget shortfall: daily emission demand first exceeded the ${SEASON1.dailyBudget} base-unit ` +
        `daily budget on day ${firstShortfallDay} — win/idle payouts were capped from then on.`,
    );
  } else {
    notes.push("Daily emission budget was never exhausted intra-day.");
  }
  if (exhaustedDay >= 0) notes.push(`Season emissions reserve fully exhausted on day ${exhaustedDay}.`);
  const last = rows[rows.length - 1];
  if (last) {
    notes.push(
      `Final ledger: circulating=${last.circulating} burned=${last.burned} pdPool=${last.pdPool} ` +
        `treasury=${last.treasury} withdrawn=${last.withdrawn} emissionsSpent=${last.emissionsSpent} ` +
        `of ${SEASON1.emissions} (remaining ${last.emissionsRemaining}).`,
    );
  }

  return { options: { ...options, mix }, rows, notes };
}
