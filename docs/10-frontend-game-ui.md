# 10 — FRONTEND: THE GAME CLIENT

## Objective
The Heist's #1 differentiator was a genuinely smooth UI on day 1. The client must feel like a
polished mobile-grade web game, not a DeFi dashboard: city map, mission board with live odds,
character den, jail, bank, store, leaderboard, and the city feed pumping wins/rekts.

## Key decisions (made)
- **Next.js 14 App Router + Tailwind + Framer Motion + Zustand** (server state via TanStack Query,
  socket layer for live events). No game engine needed — this is screens + juice, not physics.
- **Art direction:** noir city at night — deep navy/charcoal base, neon amber `$SHINY` accents,
  rain-on-glass texture, film-grain overlay. Raccoon trench-coat aesthetic. (Reuse your Liability
  design system instincts; different palette so brands stay separate.)
- **The city map is the home screen:** isometric/illustrated map of Shorefront City; locations are
  buildings with heat glows (patrol density) and live player counts. Click building → mission sheet.
- **Risk is theatre:** mission resolution gets a 3–5s suspense animation (cards flip / dice /
  security-cam static) even though the outcome was fixed at start — the slot-machine moment is the
  product. Rekt and jackpot get full-screen takeovers.
- **Mobile-first:** majority of degen traffic is phones. Bottom tab nav on mobile.

## Screen inventory
| Screen | Contents |
|---|---|
| City Map (home) | buildings, heat glows, city feed ticker, balance pill, season timer |
| Mission Sheet | live-adjusted probability table, stake input, EV display, insurance & bribe toggles, confirm → suspense → result |
| Den | character roster (cards: art, stats, status, level), station/unstation, upgrade flows, mint-event banner |
| Jail | jailed characters, countdown, bail button |
| Bank | deposit (wallet tx builder w/ memo), withdraw (fee preview, queue status), history, proof-of-reserves link |
| Precinct (Bloodhound) | patrol assignment map, shift timers, pd_pool APR, bounty history |
| Store | cosmetics, raffle tickets, insurance bundles |
| Leaderboard | top earners, top hounds, biggest single heist, most-wanted (most confiscated) |
| Transparency | burns, emissions, reserves (from doc 09) |
| Verify | provably-fair checker |

## Build checklist
- [ ] Read /mnt/skills/public/frontend-design guidance before UI generation (when using Claude
      in this environment for mockups)
- [ ] Design tokens + component kit (buttons, sheets, stat bars, probability table, toasts)
- [ ] All screens above wired to the real API
- [ ] Socket layer: city feed, own-mission resolutions, patrol changes
- [ ] Suspense/result animation system (win/loss/jackpot/rekt/arrest variants)
- [ ] Onboarding: connect → ToS → "first job free" guided Corner Store mission (free-tier)
- [ ] Empty/error/loading states for everything; mobile QA pass
- [ ] OG images + share cards ("I just hit 5× at First National") — built-in virality

## Claude Code prompt

```
Build the Trash Wars game client in apps/web (Next.js 14 App Router, TS, Tailwind, Framer
Motion, Zustand, TanStack Query, socket.io-client). The full API from docs 04–09 exists; zod
schemas in packages/shared are the contract. Wallet adapter + auth hook exist (doc 04).

DESIGN SYSTEM
1. tailwind tokens: bg #0B0E14, surface #131822, line #1F2735, text #E8ECF4, muted #8A94A6,
   accent (shiny amber) #FFB627, danger #FF4D5E, success #3DDC97, pd-blue #4D9DE0.
   Font: Inter for UI, a display font (e.g., 'Bricolage Grotesque') for headers. Subtle
   film-grain overlay component, glassmorphism sheets, neon glow utility for heat states.
2. Component kit in apps/web/components/ui: StatBar, ProbabilityTable (animated percentage
   bars, red→green gradient by outcome severity), TokenAmount (formats 6-decimals, amber glyph),
   CountdownPill, HeatBadge(none|low|med|high|blazing with glow intensity), CharacterCard
   (art, faction badge, level, status), SuspenseModal, ResultTakeover(win|jackpot|arrest|
   confiscated|rekt — distinct full-screen treatments with Framer Motion), FeedTicker.

SCREENS (App Router routes)
3. / — City Map: SVG/illustrated map (build with positioned building components over a map
   image placeholder I will replace with final art; expose a buildings.json of coordinates),
   each building shows name, player count, HeatBadge; clicking opens MissionSheet (route
   intercepting modal). Persistent: top bar (balance pill with live updates, season countdown),
   FeedTicker bottom (city-feed socket: "🦝 Sly_Bandit hit 5× at Armored Truck", "💀 K9-Rex
   seized 41k $SHINY").
4. MissionSheet: select character (or free-tier), stake input with quick chips (25/50/100%/max),
   live ProbabilityTable from the persisted-odds preview endpoint, computed EV line, insurance
   toggle (rekt-capable locations) and bribe option when heat>none, confirm -> POST -> show
   pending state with resolves-at countdown. On own-mission socket resolution: SuspenseModal
   (3.5s security-cam static + heartbeat audio toggle) then ResultTakeover.
5. /den — roster grid, station/unstation to locations, claim-idle button with accrued amount
   ticking client-side, upgrade drawer (cost curve preview), mint-event banner -> /mint flow
   with live remaining counter and burn framing ("Minting burns 25,000 $SHINY forever").
6. /jail, /bank (deposit builds the memo tx via wallet adapter; withdraw shows 5% fee math,
   queue position, history), /precinct (Bloodhound-gated: patrol map, weight caps shown,
   APR chart from /pvp/stats), /store, /leaderboard (tabs), /transparency, /verify.
7. Onboarding wizard for new sessions: connect -> ToS -> balance check -> guided free Corner
   Store mission with tooltips. 
8. State: Zustand stores for session, balances (socket-invalidated), feed buffer (cap 50).
   TanStack Query for all reads with sensible staleTimes. Optimistic UI nowhere money moves.
9. Share cards: /api/og route (Vercel OG) generating result images; ResultTakeover has
   'Share on X' with prefilled text.
10. Mobile: bottom tab nav (City/Den/Bank/Store/More), all sheets become bottom drawers,
    test at 390px. Lighthouse perf >85 on /.

Use placeholder art (solid-color silhouettes) everywhere with a single ART_MANIFEST.ts so
final art drops in without code changes. Storybook optional; a /kitchen-sink dev route
showing every component state is required.
```

## Acceptance criteria
- Full loop playable on devnet from a phone: deposit → mission → suspense → result → withdraw
- Feed ticker live; jackpot takeover is screenshot-worthy
- Kitchen-sink route demonstrates every state; Lighthouse >85
