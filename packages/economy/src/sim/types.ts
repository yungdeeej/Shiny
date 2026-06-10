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
 *  deposited + emissionsSpent === playerBalances + burned + pdPool + jackpotPool + treasury + withdrawn */
export interface Ledger {
  /** External tokens brought into the game (market buys / bankrolls / mints / jackpot seed). */
  deposited: bigint;
  /** Season emissions actually paid out (idle accrual + win excess). */
  emissionsSpent: bigint;
  /** Cumulative burns (mints, upgrades, loss shares, bail shares, insurance). */
  burned: bigint;
  /** PD confiscation pool awaiting daily distribution to Bloodhounds. */
  pdPool: bigint;
  /** v1.1 progressive jackpot pool: 2M day-0 seed + 5% of lost stakes (specs/03). */
  jackpotPool: bigint;
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
  /** Patrol bounties paid straight from confiscated stakes to patrolling hounds. */
  dailyPatrolBounty: bigint;
  dailyWinExcess: bigint;
  dailyIdle: bigint;
  /** Emission payouts requested before the daily clamp (win excess + idle demand). */
  dailyEmissionDemand: bigint;
  /** Lost-stake volume (confiscation + rekt) routed through bounty/burn/PD. */
  dailyLossVolume: bigint;
  /** Total stake volume across all missions today. */
  dailyStakeVolume: bigint;
  /** 5% loss-split inflow to the jackpot pool today. */
  dailyJackpotIn: bigint;
  /** Pool paid out to jackpot winners today (pool − 10% floor per hit). */
  dailyJackpotPaid: bigint;
  /** Pool hits today (jackpot outcome at a jackpotEligible location, day ≥ 56). */
  jackpotHits: number;
  missions: number;
  arrests: number;
  confiscations: number;
  rekts: number;
  /** Bloodhounds minted and alive (owner may be inactive today). */
  livingHounds: number;
  /** Bloodhounds actively staked/patrolling today. */
  stakedHounds: number;
  /** True when emission demand exceeded the day's budget (payouts were capped). */
  budgetShortfall: boolean;
  /** (dailyEmissions - dailyBurned) / circulating, in bps. Reporting only. */
  netInflationBps: number;
  /** (PD distributions + patrol bounties) as a share of gross player earnings, in bps. */
  redistributionShareBps: number;
  /**
   * Bloodhound APR per the owner definition: annualized (pd distributions +
   * patrol bounties) / (living bloodhound count * 60k mint price), in bps.
   */
  pdAprBps: number;
  /** Same numerator over actively staked hounds only (decay-scenario view). */
  pdAprStakedBps: number;
}

export interface SimResult {
  options: SimOptions & { mix: Record<Archetype, number> };
  rows: DayRow[];
  notes: string[];
  /**
   * Static Street Cred tier distribution implied by the archetype mix (specs/01):
   * each archetype is assigned an assumed wallet-held $SHINY balance and mapped
   * through the shared tierForHolding. Reporting only — no sim behavior changes.
   */
  tierDistribution: Record<string, number>;
}
