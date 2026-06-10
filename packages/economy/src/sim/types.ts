export type Archetype = "grinder" | "extractor" | "whale" | "tourist" | "pd_farmer";

export const ARCHETYPES: readonly Archetype[] = [
  "grinder",
  "extractor",
  "whale",
  "tourist",
  "pd_farmer",
];

export type DauCurve = "growth" | "plateau" | "decay";

export interface SimOptions {
  days: number;
  players: number;
  dauCurve: DauCurve;
  seed: number | string;
  /** Population mix; defaults to grinder .35 / extractor .20 / whale .05 / tourist .30 / pd_farmer .10 */
  mix?: Partial<Record<Archetype, number>>;
}

/** Double-entry style ledger. Invariant (asserted every simulated day):
 *  deposited + emissionsSpent === playerBalances + burned + pdPool + treasury + withdrawn */
export interface Ledger {
  /** External tokens brought into the game (market buys / bankrolls / mints). */
  deposited: bigint;
  /** Season emissions actually paid out (idle accrual + win excess). */
  emissionsSpent: bigint;
  /** Cumulative burns (mints, upgrades, loss shares, bail shares, insurance). */
  burned: bigint;
  /** PD confiscation pool awaiting daily distribution to Bloodhounds. */
  pdPool: bigint;
  /** Withdrawal-tax rake (team revenue). */
  treasury: bigint;
  /** Net tokens withdrawn off-game (after tax). */
  withdrawn: bigint;
}

export interface DayRow extends Ledger {
  day: number;
  dau: number;
  /** Sum of all player balances at end of day. */
  playerBalances: bigint;
  emissionsRemaining: bigint;
  /** Tokens in existence around the game = deposited + emissionsSpent - burned. */
  circulating: bigint;
  dailyEmissions: bigint;
  dailyBurned: bigint;
  dailyRake: bigint;
  dailyPdDistributed: bigint;
  dailyWinExcess: bigint;
  dailyIdle: bigint;
  missions: number;
  arrests: number;
  confiscations: number;
  rekts: number;
  /** True when emission demand exceeded the day's budget (payouts were capped). */
  budgetShortfall: boolean;
  /** (dailyEmissions - dailyBurned) / circulating, in bps. Reporting only. */
  netInflationBps: number;
  /** PD redistribution as a share of gross player earnings, in bps. Reporting only. */
  redistributionShareBps: number;
  /** Annualized PD yield on bloodhound mint capital, in bps. Reporting only. */
  pdAprBps: number;
}

export interface SimResult {
  options: SimOptions & { mix: Record<Archetype, number> };
  rows: DayRow[];
  notes: string[];
}
