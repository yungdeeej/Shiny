# 12 — LAUNCH OPS & COMMUNITY PLAYBOOK

## Objective
Replicate the part of The Heist that wasn't code: a 6-week teaser arc, near-daily comms cadence,
burn-announcement theatre, and season content drops. The Muse Labs post-mortem of their timeline is
effectively a marketing template — this doc operationalizes it for Trash Wars.

## The Heist's cadence, transposed (T-45 → T+90)

| Phase | Their move | Your move |
|---|---|---|
| Tease (T-45) | Single image: monkeys stealing bananas, no explanation | Single image: raccoons cracking a safe under neon rain. No text but the date. X + nothing else |
| T-40 | Discord opens with in-world art | Discord opens "Shorefront City PD tip line". Whitelist = $SHINY airdrop list now (no NFT WL needed) |
| T-35 → T-20 | Faction reveals (Chimps, then Gorillas "10%, +25% earnings") | Reveal Raccoons → Bloodhounds ("10% cap, paid from confiscations — the cops eat what you lose") → tease Crows for S2 |
| T-30 | "We're building the biggest game on Solana" flex | Closed beta opens (devnet). Beta grinders earn airdrop allocation — *play* is the whitelist task, not retweets |
| T-14 | Tokenomics published | Tokenomics Gitbook + transparency page live; AMA #1 |
| T-7 | Mint date + price announced | Alpha Vault date + price + exact supply math announced; tutorial video |
| T-0 | Mint, token live same day, game live T+2 | Vault → DAMM → deposits same day → missions T+1 ("playable in 24h" is the headline) |
| T+3 | "First chimp is dead" | First rekt + first jackpot amplified as lore posts (city newspaper format: *The Shorefront Sentinel*) |
| T+7 | First burn announcement with numbers | Weekly burn thread, every week, no exceptions (doc 09 auto-drafts) |
| T+14 | Recruitment raffle (mint via burned raffle tickets) | Recruitment Raffle Wave 1 |
| T+30 | New stats, features weekly | Bloodhound PD activation event (PvP live) — your biggest content beat |
| T+90 | Season 2 | "Murder of Crows" — new faction, marketplace, emissions step-down framed as halving |

## Content engine
- **The Shorefront Sentinel** — in-world newspaper account on X. Every big game event becomes a
  headline ("MASKED RACCOON ESCAPES MINT WITH 12× HAUL; PD HUMILIATED"). Your FLUX pipeline +
  Claude API can generate these semi-automatically from city-feed webhooks — build it as an ops
  script (prompt below).
- **Weekly rituals:** Monday stats thread (auto from /public/stats), Wednesday lore drop,
  Sunday burn thread. Cadence > cleverness.
- **Scam defense from day 1:** The Heist got impersonator-swarmed immediately after success.
  Pre-register lookalike handles, pin a "we will never DM first" notice, Discord security bot,
  verified-links channel.
- **KOL policy:** gameplay-seeded only (give beta access + small airdrop), no paid shill threads
  pre-TGE — paid promo before a fair launch reads as exit-prep and invites regulatory attention.

## Build checklist
- [ ] Handles secured (X, Discord, Telegram announce-only), lookalikes squatted
- [ ] Gitbook: tokenomics, how-to-play, provably-fair explainer, proof-of-reserves link
- [ ] Beta program: 200–500 testers, airdrop allocation rules published
- [ ] Sentinel content pipeline (prompt below)
- [ ] Discord structure: tip-line onboarding, faction roles, city-feed mirror channel (webhook
      from the game), support tickets, security bot
- [ ] AMA schedule (T-14, T-1, T+7, then biweekly town halls — Heist did these)
- [ ] Crisis runbooks: exploit found (pause → disclose → compensate policy pre-written),
      token -50% day (response = ship + burn, never promises)

## Claude Code prompt (content automation)

```
Build ops/sentinel: a content automation service for Trash Wars marketing.

1. Webhook consumer subscribing to the game's city-feed events (socket or an internal
   /internal/events endpoint with shared secret). Filter for: jackpots >= 5x, character
   deaths, confiscations > 25k, raffle results, weekly burn completion.
2. For each qualifying event, call the Anthropic API (claude-sonnet, key from env) with a
   system prompt establishing "The Shorefront Sentinel" voice: 1940s noir crime-beat
   reporter covering raccoon crime in a neon city; output a tweet-length headline + 2-3
   sentence story + image prompt. Few-shot examples included in the system prompt (write 5).
3. Image generation: send the image prompt to FAL.ai FLUX Pro (env key) with a locked style
   suffix (noir, neon rain, film grain, editorial illustration) -> store image.
4. Human-in-the-loop: post the drafted text + image to a Discord review webhook with
   approve/reject buttons (Discord interactions endpoint); on approve, post via X API v2
   (env tokens) and mirror to the Discord announcements webhook.
5. Scheduled jobs: Monday stats thread (pull /public/stats, render a stats card image with
   satori/sharp, draft thread), Sunday burn thread (pull /public/burns latest, draft from
   the breakdown).
6. Rate limits: max 4 event posts/day, dedupe similar events within 6h, never post amounts
   for identifiable users without their public flag (respect a user setting feed_anonymous).
7. Dry-run mode that writes everything to ops/sentinel/out/ instead of posting.

Keep it a small standalone service (services/sentinel) sharing packages/shared types.
```

## Acceptance criteria
- Beta cohort active ≥2 weeks pre-TGE with retention data informing economy tuning
- Sentinel producing approved posts within 10 min of qualifying events
- Every weekly ritual shipped 4 weeks straight before TGE week
