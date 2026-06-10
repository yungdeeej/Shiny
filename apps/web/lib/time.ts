/**
 * Beta time scale: 1 real minute = 1 game hour (60×).
 * Everything stored in real timestamps; durations specified in game hours are
 * converted through these helpers.
 */
export const DEMO_TIME_SCALE = 60;

const REAL_HOUR_MS = 3_600_000;

/** Real milliseconds that a duration of `hours` game-hours takes in the beta. */
export function gameHoursToRealMs(hours: number): number {
  return (hours * REAL_HOUR_MS) / DEMO_TIME_SCALE;
}

/** Game hours elapsed between two real timestamps. */
export function realMsToGameHours(ms: number): number {
  return (ms * DEMO_TIME_SCALE) / REAL_HOUR_MS;
}

/** "2m 30s" style countdown for a real-ms remainder. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Human duration for a game-hour figure at beta speed: "2h job · 2m real". */
export function formatGameDuration(hours: number): string {
  const realMin = (hours * 60) / DEMO_TIME_SCALE;
  const real =
    realMin >= 1 ? `${Math.round(realMin)}m real` : `${Math.round(realMin * 60)}s real`;
  return `${hours}h job · ${real}`;
}

/** Relative "3m ago" formatting. */
export function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
