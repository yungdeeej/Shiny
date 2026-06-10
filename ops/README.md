# ops/ — Trash Wars operational surface

Index of the operational tooling around the game services. Everything here is
human-triggered; nothing in ops/ runs automatically in production.

| Area | Where | What |
|---|---|---|
| **TGE launch runbook** | [`launch/README.md`](launch/README.md) | `@trash-wars/launch-ops` — mint $SHINY, distribute the 1B split, verify on-chain, airdrop, Heist-holder snapshot. Dry-run by default, manifests in `launch/out/` (gitignored). Meteora Alpha Vault + DAMM v2 steps are MANUAL with a checklist. |
| **Buyback & burn** | [`launch/src/buyback.ts`](launch/src/buyback.ts) | Jupiter v6 SOL→SHINY swap with slippage + price-impact guards, then on-chain burn of the proceeds. Admin-triggered only (docs/09 — automatic buybacks get front-run). |
| **Sentinel content engine** | [`../services/sentinel/`](../services/sentinel/README.md) | The Shorefront Sentinel (docs/12), beta-scoped: polls `/public/stats` + the city feed, drafts noir posts (templates; Claude behind `ANTHROPIC_API_KEY`), writes to `sentinel-out/` (gitignored) for human review. Max 4 posts/day, 6h dedupe. |
| **Proof of reserves** | served by the API | `GET /public/reserves` (docs/05/09) — on-chain reserves vs ledger liabilities. The launch manifests in `launch/out/` are the genesis inputs for that page. |

Gitignored output dirs (see [`.gitignore`](.gitignore)): `launch/out/`,
`sentinel-out/`.
