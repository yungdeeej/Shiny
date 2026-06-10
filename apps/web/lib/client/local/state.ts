import type { Character, Listing, Mission, MissionResult, Raffle, Withdrawal } from "@trash-wars/shared";
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
  };
}

export function loadSave(): SaveState {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as SaveState;
    if (parsed.v !== 1) return defaultSave();
    return { ...defaultSave(), ...parsed, stats: { ...defaultSave().stats, ...parsed.stats } };
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
