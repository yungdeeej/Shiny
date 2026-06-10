import { JACKPOT, type Character, type CredTier, type Listing, type Mission, type MissionResult, type Raffle, type Withdrawal } from "@trash-wars/shared";
import { DEMO_V11 } from "./content";
import type { BankHistoryRow } from "../types";

/**
 * Persisted save. Everything is wire-format (amounts = base-unit decimal
 * strings, times = ISO strings) so plain JSON round-trips losslessly — bigint
 * math is done transiently in the engine.
 */
export interface StoredMission extends Mission {
  /** secret until resolved; revealed in result */
  serverSeed: string;
  result?: MissionResult;
}

export interface StoredPatrol {
  id: string;
  characterId: string;
  characterName: string;
  locationSlug: string;
  weight: number;
  startedAt: string;
  shiftEndsAt: string;
  settled: boolean;
}

export interface StoredRaffle extends Raffle {
  serverSeed: string;
}

export interface PlayerStats {
  totalEarned: string;
  biggestHeist: string;
  totalConfiscated: string;
  houndEarned: string;
  missionCount: number;
  lastFaucetAt: string | null;
  lastFreeTierAt: string | null;
  loginFragments: number;
  freeTicketsClaimed: number;
}

/** v1.1 — progressive jackpot pool (specs/03), demo-compressed. */
export interface JackpotSave {
  pool: string;
  /** Set at first login (+15 real min); null while logged out. */
  winnableAt: string | null;
  hits: number;
  lastWinner: { handle: string; amount: string; at: string } | null;
  /** last processed bot-loss accrual bucket */
  lastBotBucket: number;
  history: Array<{ kind: "seed" | "win"; handle: string | null; amount: string; poolAfter: string; at: string }>;
}

/** v1.1 — season pass progress (specs/02). */
export interface PassSave {
  premium: boolean;
  xp: number;
  /** claimed reward ids */
  claimed: string[];
  vouchers: number;
  /** demo game-day index used for daily XP caps */
  xpDayIndex: number;
  raffleXpToday: number;
  /** last game-day that received the daily-first-mission bonus */
  firstMissionDayIndex: number | null;
  challengeProgress: Record<string, number>;
  /** challenge ids whose 150 XP has been granted */
  challengeAwarded: string[];
  /** Borough+ weekly raffle ticket grant — last granted week index */
  lastRaffleGrantWeek: number;
}

export interface SaveState {
  v: 1;
  user: {
    id: string;
    handle: string;
    createdAt: string;
    tosAcceptedVersion: string | null;
  } | null;
  balance: string;
  characters: Character[];
  missions: StoredMission[];
  patrols: StoredPatrol[];
  withdrawals: Withdrawal[];
  bankHistory: BankHistoryRow[];
  /** cosmetic slugs owned but not equipped */
  inventory: string[];
  raffles: StoredRaffle[];
  myListings: Listing[];
  /** bot listing ids the player bought (hidden from the ambient set) */
  purchasedBotListings: string[];
  playerMints: Record<string, number>;
  stats: PlayerStats;
  burnedByPlayer: string;
  treasuryFromPlayer: string;
  pdFromPlayer: string;
  firstLoginAt: string | null;
  lastSeenBucket: number;
  /* ── v1.1 ── */
  /** Simulated on-chain wallet holding (Street Cred beta stand-in). */
  simulatedHolding: string;
  /** Effective tier (downgrades lag behind holding via the grace window). */
  credTier: CredTier;
  /** While set, a downgrade is pending — applies when this passes. */
  credGraceUntil: string | null;
  jackpot: JackpotSave;
  pass: PassSave;
}

export const SAVE_KEY = "trash-wars-save-v1";

export function defaultSave(): SaveState {
  return {
    v: 1,
    user: null,
    balance: "0",
    characters: [],
    missions: [],
    patrols: [],
    withdrawals: [],
    bankHistory: [],
    inventory: [],
    raffles: [],
    myListings: [],
    purchasedBotListings: [],
    playerMints: {},
    stats: {
      totalEarned: "0",
      biggestHeist: "0",
      totalConfiscated: "0",
      houndEarned: "0",
      missionCount: 0,
      lastFaucetAt: null,
      lastFreeTierAt: null,
      loginFragments: 0,
      freeTicketsClaimed: 0,
    },
    burnedByPlayer: "0",
    treasuryFromPlayer: "0",
    pdFromPlayer: "0",
    firstLoginAt: null,
    lastSeenBucket: 0,
    simulatedHolding: DEMO_V11.defaultHolding.toString(),
    credTier: "alley",
    credGraceUntil: null,
    jackpot: {
      pool: JACKPOT.seedAmount.toString(),
      winnableAt: null,
      hits: 0,
      lastWinner: null,
      lastBotBucket: 0,
      history: [],
    },
    pass: {
      premium: false,
      xp: 0,
      claimed: [],
      vouchers: 0,
      xpDayIndex: 0,
      raffleXpToday: 0,
      firstMissionDayIndex: null,
      challengeProgress: {},
      challengeAwarded: [],
      lastRaffleGrantWeek: -1,
    },
  };
}

export function loadSave(): SaveState {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as SaveState;
    if (parsed.v !== 1) return defaultSave();
    const base = defaultSave();
    return {
      ...base,
      ...parsed,
      stats: { ...base.stats, ...parsed.stats },
      // v1.1 nested state: merge so pre-v1.1 saves pick up the defaults
      jackpot: { ...base.jackpot, ...(parsed.jackpot ?? {}) },
      pass: { ...base.pass, ...(parsed.pass ?? {}) },
    };
  } catch {
    return defaultSave();
  }
}

export function persistSave(state: SaveState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // storage full / private mode — beta keeps running in memory
  }
}
