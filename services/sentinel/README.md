# @trash-wars/sentinel — The Shorefront Sentinel (beta scope)

In-world newspaper content automation per `docs/12-launch-ops-community.md`,
deliberately cut down for beta:

| Piece | Beta status |
|---|---|
| Feed consumption (`src/consume.ts`) | ✅ filters jackpots ≥ 5×, deaths, confiscations > 25k, raffles, weekly burns |
| Voice (`src/voice.ts`) | ✅ template generation (~6 headlines/event type); Claude Messages API path activates only when `ANTHROPIC_API_KEY` is set (plain fetch, model `claude-sonnet-4-6`, falls back to templates on error) |
| Images (`src/publish.ts`) | prompt always written to the draft; FAL FLUX call stubbed behind `FAL_KEY` (unverified) |
| Posting to X / Discord | ❌ stub — drafts land in `ops/sentinel-out/` for human review |
| Rate limits (`src/state.ts`) | ✅ max 4 event posts/day, 6h dedupe, persisted state |

Run: `GAME_API_URL=http://localhost:8080 pnpm --filter @trash-wars/sentinel dev`

Dry-run is the default and, in beta, the only mode — `SENTINEL_EXECUTE=1` just
logs that posting is a stub. Output dir override: `SENTINEL_OUT_DIR`.
