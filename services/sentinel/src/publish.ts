/**
 * Output side of the Sentinel. BETA SCOPE — honest about what's stubbed:
 *
 *  - Dry-run is the DEFAULT and currently the only real path: drafted posts are
 *    written to ops/sentinel-out/ as .json + .md for human review.
 *  - Image generation: the FAL.ai FLUX call only fires when FAL_KEY is set and
 *    is marked unverified — in beta we always persist the image *prompt*.
 *  - X / Discord posting: NOT implemented in beta. publishDraft() logs and
 *    returns; the human-in-the-loop approve→post pipeline is a later phase.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoryEvent } from "./consume.js";
import type { DraftPost } from "./voice.js";

// services/sentinel/src → repo root → ops/sentinel-out (gitignored via ops/.gitignore)
export const OUT_DIR =
  process.env.SENTINEL_OUT_DIR ??
  fileURLToPath(new URL("../../../ops/sentinel-out/", import.meta.url));

export interface WrittenDraft {
  jsonPath: string;
  mdPath: string;
}

export function writeDraft(evt: StoryEvent, post: DraftPost, imageNote: string): WrittenDraft {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(OUT_DIR, `${stamp}-${evt.kind}`);

  const jsonPath = `${base}.json`;
  writeFileSync(jsonPath, JSON.stringify({ event: evt, post, imageNote }, null, 2) + "\n");

  const mdPath = `${base}.md`;
  writeFileSync(
    mdPath,
    `# ${post.headline}\n\n${post.story}\n\n---\n\n` +
      `**Image prompt:** ${post.imagePrompt}\n\n` +
      `**Image:** ${imageNote}\n\n` +
      `_generator: ${post.generator} · event: ${evt.kind} (${evt.sourceId}) · ${evt.at}_\n`,
  );
  return { jsonPath, mdPath };
}

/**
 * FAL.ai FLUX Pro image generation — stubbed behind FAL_KEY, same pattern as
 * the Anthropic call. ⚠ UNVERIFIED in beta: the endpoint/payload shape below
 * follows fal.ai's documented sync REST API but has not been exercised; treat a
 * failure as non-fatal (the prompt is always saved to the draft regardless).
 */
export async function maybeGenerateImage(prompt: string): Promise<string> {
  if (!process.env.FAL_KEY) return "skipped (no FAL_KEY — beta writes the prompt only)";
  try {
    const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt, image_size: "landscape_4_3" }),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { images?: { url?: string }[] };
    return data.images?.[0]?.url ?? "fal returned no image url";
  } catch (err) {
    return `fal call failed (non-fatal): ${String(err)}`;
  }
}

/**
 * BETA STUB — posting to X / mirroring to Discord is intentionally not
 * implemented. Drafts live in ops/sentinel-out/ for a human to review and post.
 */
export function publishDraft(written: WrittenDraft): void {
  if (process.env.SENTINEL_EXECUTE === "1") {
    console.warn(
      "publish: SENTINEL_EXECUTE=1 set, but X/Discord posting is a beta stub — draft remains at " +
        written.mdPath,
    );
  } else {
    console.log(`publish: dry-run (default) — draft written to ${written.mdPath}`);
  }
}
