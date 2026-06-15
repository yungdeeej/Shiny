/**
 * The Shorefront Sentinel — beta service entrypoint.
 *
 * Polls the game API (GAME_API_URL) for:
 *   - GET /public/stats  → logged each cycle (feeds the Monday stats thread later)
 *   - GET /public/feed   → city-feed events, filtered by consume.handleFeedEvent
 *
 * Qualifying events are drafted in the Sentinel voice (templates by default,
 * Claude when ANTHROPIC_API_KEY is set) and written to ops/sentinel-out/ for
 * human review. Max 4 event posts/day, 6h dedupe of similar events.
 *
 * Env: GAME_API_URL (required), GAME_FEED_PATH (default /public/feed),
 *      SENTINEL_POLL_MS (default 60000), ANTHROPIC_API_KEY?, FAL_KEY?,
 *      SENTINEL_OUT_DIR?, SENTINEL_EXECUTE? (posting itself is a beta stub).
 */
import { z } from "zod";
import { handleFeedEvent } from "./consume.js";
import { draftPost } from "./voice.js";
import { maybeGenerateImage, publishDraft, writeDraft } from "./publish.js";
import { alreadySeen, blockReason, loadState, markSeen, recordPost, saveState } from "./state.js";

const API_URL = process.env.GAME_API_URL;
if (!API_URL) {
  console.error("GAME_API_URL env is required (e.g. http://localhost:8080)");
  process.exit(1);
}
const FEED_PATH = process.env.GAME_FEED_PATH ?? "/public/feed";
const POLL_MS = Number(process.env.SENTINEL_POLL_MS ?? 60_000);

const feedResponse = z.array(z.unknown());

async function getJson(pathname: string): Promise<unknown> {
  const res = await fetch(`${API_URL}${pathname}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${pathname} → ${res.status}`);
  return res.json();
}

async function cycle(): Promise<void> {
  // 1. stats — logged for now; the Monday stats thread job builds on this later.
  try {
    const stats = (await getJson("/public/stats")) as Record<string, unknown>;
    console.log(
      `stats: players=${stats.players ?? "?"} missionsToday=${stats.missionsToday ?? "?"} burnedTotal=${stats.burnedTotal ?? "?"}`,
    );
  } catch (err) {
    console.warn(`stats poll failed: ${String(err)}`);
  }

  // 2. feed
  let rawEvents: unknown[];
  try {
    const body = await getJson(FEED_PATH);
    // accept both a bare array and { events: [...] }
    const maybe = Array.isArray(body) ? body : (body as { events?: unknown[] })?.events;
    rawEvents = feedResponse.parse(maybe ?? []);
  } catch (err) {
    console.warn(`feed poll failed: ${String(err)}`);
    return;
  }

  const state = loadState();
  for (const raw of rawEvents) {
    const id = (raw as { id?: string })?.id;
    if (!id || alreadySeen(state, id)) continue;
    markSeen(state, id);

    const story = handleFeedEvent(raw);
    if (!story) continue;

    const blocked = blockReason(state, story);
    if (blocked) {
      console.log(`skip ${story.kind} (${id}): ${blocked}`);
      continue;
    }

    try {
      const post = await draftPost(story);
      const imageNote = await maybeGenerateImage(post.imagePrompt);
      const written = await writeDraft(story, post, imageNote);
      publishDraft(written);
      recordPost(state, story);
      console.log(`drafted [${post.generator}] ${story.kind}: ${post.headline}`);
    } catch (err) {
      console.error(`draft failed for ${id}: ${String(err)}`);
    }
  }
  saveState(state);
}

console.log(`Shorefront Sentinel (beta) — polling ${API_URL} every ${POLL_MS}ms; drafts → ops/sentinel-out/`);
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

while (running) {
  await cycle();
  await new Promise((r) => setTimeout(r, POLL_MS));
}
console.log("sentinel: shutting down");
