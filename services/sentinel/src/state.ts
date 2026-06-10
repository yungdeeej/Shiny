/**
 * Rate limiting + dedupe state, persisted to ops/sentinel-out/state.json so a
 * restart doesn't reset the daily budget.
 *
 * Rules (docs/12): max 4 event posts per UTC day; dedupe similar events
 * (same kind + actor + location) within 6 hours.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StoryEvent } from "./consume.js";
import { OUT_DIR } from "./publish.js";

const MAX_POSTS_PER_DAY = 4;
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

interface SentinelState {
  /** UTC date string the counter applies to, e.g. "2026-06-10" */
  day: string;
  postsToday: number;
  /** dedupe keys → epoch ms of last post */
  recent: Record<string, number>;
  /** feed event ids already considered (bounded) */
  seenIds: string[];
}

const STATE_PATH = path.join(OUT_DIR, "state.json");

function fresh(now: Date): SentinelState {
  return { day: now.toISOString().slice(0, 10), postsToday: 0, recent: {}, seenIds: [] };
}

export function loadState(now = new Date()): SentinelState {
  let state = fresh(now);
  if (existsSync(STATE_PATH)) {
    try {
      state = { ...state, ...(JSON.parse(readFileSync(STATE_PATH, "utf8")) as SentinelState) };
    } catch {
      console.warn("state: corrupt state.json, starting fresh");
    }
  }
  const today = now.toISOString().slice(0, 10);
  if (state.day !== today) {
    state.day = today;
    state.postsToday = 0;
  }
  // expire dedupe entries
  for (const [k, t] of Object.entries(state.recent)) {
    if (now.getTime() - t > DEDUPE_WINDOW_MS) delete state.recent[k];
  }
  return state;
}

export function saveState(state: SentinelState): void {
  mkdirSync(OUT_DIR, { recursive: true });
  state.seenIds = state.seenIds.slice(-2000);
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function dedupeKey(evt: StoryEvent): string {
  return `${evt.kind}:${evt.actor ?? "-"}:${evt.locationSlug ?? "-"}`;
}

export function alreadySeen(state: SentinelState, eventId: string): boolean {
  return state.seenIds.includes(eventId);
}

export function markSeen(state: SentinelState, eventId: string): void {
  if (!state.seenIds.includes(eventId)) state.seenIds.push(eventId);
}

/** Returns a reason string when the event must NOT be posted, null when ok. */
export function blockReason(state: SentinelState, evt: StoryEvent, now = new Date()): string | null {
  if (state.postsToday >= MAX_POSTS_PER_DAY) return `daily budget reached (${MAX_POSTS_PER_DAY}/day)`;
  const last = state.recent[dedupeKey(evt)];
  if (last !== undefined && now.getTime() - last < DEDUPE_WINDOW_MS)
    return `similar event posted ${Math.round((now.getTime() - last) / 60_000)}min ago (6h dedupe)`;
  return null;
}

export function recordPost(state: SentinelState, evt: StoryEvent, now = new Date()): void {
  state.postsToday += 1;
  state.recent[dedupeKey(evt)] = now.getTime();
}
