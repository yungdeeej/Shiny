/**
 * Game-time scaling (BETA_TIME_SCALE). All durations in the game are expressed in
 * GAME hours; at scale 60 one real minute is one game hour, so a 2h mission lasts
 * 2 real minutes in beta and idle accrual runs 60x.
 */
export interface GameClock {
  readonly scale: number;
  /** Real ms that `h` game hours take. */
  gameHoursToMs(h: number): number;
  /** Real ms that `m` game minutes take. */
  gameMinutesToMs(m: number): number;
  /** Game hours elapsed between two real timestamps (ms). */
  elapsedGameHours(fromMs: number, toMs: number): number;
  /** Whole game-days elapsed since an epoch (real ms) — drives daily ticks. */
  gameDayIndex(epochMs: number, nowMs: number): number;
}

export function makeClock(scale: number): GameClock {
  if (!(scale > 0)) throw new Error(`invalid time scale: ${scale}`);
  return {
    scale,
    gameHoursToMs: (h) => Math.max(1, Math.round((h * 3_600_000) / scale)),
    gameMinutesToMs: (m) => Math.max(0, Math.round((m * 60_000) / scale)),
    elapsedGameHours: (fromMs, toMs) => (Math.max(0, toMs - fromMs) * scale) / 3_600_000,
    gameDayIndex: (epochMs, nowMs) =>
      Math.max(0, Math.floor((Math.max(0, nowMs - epochMs) * scale) / 86_400_000)),
  };
}

/** Real calendar day key (UTC) — used for emissions counters and faucet limits. */
export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
