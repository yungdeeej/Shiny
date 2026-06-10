/**
 * LocalGameClient — the in-browser beta engine. A complete implementation of
 * the GameClient surface persisted to localStorage, using the REAL economy
 * math (provably-fair seeds, stat/patrol modifiers, sink splits) at 60× time.
 */
import {
  PROVABLY_FAIR_ALGORITHM,
  SEASON1_LOCATIONS,
  applyBribe,
  applyPatrolModifiers,
  applyStatModifiers,
  bailPrice,
  commitHash,
  computePayout,
  generateServerSeed,
  idleRatePerHour,
  insurancePrice,
  makeRng,
  mintPrice,
  raffleTicketPrice,
  resolveMission,
  rollFromSeeds,
  sha256Hex,
  splitBail,
  upgradeCost,
} from "@trash-wars/economy";
import {
  JACKPOT,
  PASS,
  POLICY,
  SINKS,
  STAT_EFFECTS,
  TIER_DEFINITIONS,
  TOS_VERSION,
  ZERO_STATS,
  applyBps,
  nextTier,
  tierForHolding,
  toBaseUnits,
  type Character,
  type CharacterStats,
  type CosmeticItem,
  type CredInfo,
  type CredTier,
  type FeedEvent,
  type JackpotState,
  type LeaderboardEntry,
  type Listing,
  type LocationConfig,
  type LocationLive,
  type MeResponse,
  type MintEvent,
  type Mission,
  type MissionResult,
  type MissionStartRequest,
  type MissionVerify,
  type PassState,
  type Patrol,
  type ProofOfReserves,
  type PublicStats,
  type PvpStats,
  type Raffle,
  type StatKey,
  type TierPerks,
  type Withdrawal,
} from "@trash-wars/shared";
import { gameHoursToRealMs, realMsToGameHours } from "../../time";
import {
  GameClientError,
  type BankHistoryRow,
  type GameClient,
  type LeaderboardBoard,
  type MissionsResponse,
  type ResolvedMission,
  type Unsubscribe,
  type UserEvent,
} from "../types";
import {
  ambientPatrolWeight,
  botListings,
  botLeaderboard,
  botMintTaken,
  botTicketsSold,
  bucketIndex,
  feedEventForBucket,
  formatBand,
  heatAt,
  playersActiveAt,
  recentFeed,
  syntheticPublicStats,
} from "./bots";
import {
  DEMO_V11,
  LOCAL_POLICY,
  PASS_CHALLENGE_POOL,
  PASS_REWARDS,
  PENTHOUSE_LOCATION,
  STORE_ITEMS,
  type PassChallengeDef,
} from "./content";
import {
  defaultSave,
  loadSave,
  persistSave,
  type SaveState,
  type StoredMission,
  type StoredPatrol,
  type StoredRaffle,
} from "./state";

const big = (s: string): bigint => BigInt(s);
const str = (b: bigint): string => b.toString();

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return sha256Hex(`${Math.random()}:${Date.now()}`).slice(0, 32);
}

function err(code: string, message: string): never {
  throw new GameClientError(code, message);
}

const STARTER_NAMES = ["Dusty", "Patches", "Grimey", "Smudge", "Banjo", "Pickle", "Soot", "Marbles"];
const MINT_RACCOON = "mint-raccoon-s1";
const MINT_BLOODHOUND = "mint-bloodhound-s1";
const MINT_WAVE = "mint-wave-s1";

/** All demo locations: Season 1 six + the Kingpin-gated penthouse. */
const ALL_LOCATIONS: LocationConfig[] = [...SEASON1_LOCATIONS, PENTHOUSE_LOCATION];

/** Demo game-week in real ms (168 game hours at 60×) — challenge rotation. */
const GAME_WEEK_REAL_MS = gameHoursToRealMs(168);
/** Demo game-day in real ms — daily XP caps. */
const GAME_DAY_REAL_MS = gameHoursToRealMs(24);

/** Human label for a tier. */
const TIER_NAMES: Record<CredTier, string> = {
  none: "No Cred",
  alley: "Alley",
  block: "Block",
  district: "District",
  borough: "Borough",
  kingpin: "Kingpin",
};

/** Average confiscation flow per game-hour (whole SHINY) — drives patrol bounties. */
const CONF_FLOW: Record<string, number> = {
  "corner-store": 150,
  "pawn-shop": 420,
  "jewelry-district": 950,
  "armored-truck": 1_500,
  "first-national": 2_300,
  "the-mint": 3_400,
};

export class LocalGameClient implements GameClient {
  private state: SaveState;
  private feedSubs = new Set<(e: FeedEvent) => void>();
  private userSubs = new Set<(e: UserEvent) => void>();
  private jackpotSubs = new Set<(s: JackpotState) => void>();
  private feedBuffer: FeedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.state = loadSave();
    const now = Date.now();
    this.feedBuffer = recentFeed(now, 18);
    this.state.lastSeenBucket = bucketIndex(now);
    this.ensureV11(now);
    if (this.state.user) {
      this.state.stats.loginFragments += 1;
      this.grantFragmentTickets();
    }
    this.advance(now);
    this.save();
    if (typeof window !== "undefined") {
      this.timer = setInterval(() => {
        this.advance(Date.now());
      }, 1000);
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ── internals ──────────────────────────────────────────────────── */

  private save(): void {
    persistSave(this.state);
  }

  private emitUser(e: UserEvent): void {
    for (const cb of this.userSubs) cb(e);
  }

  private emitFeed(e: FeedEvent): void {
    this.feedBuffer.push(e);
    if (this.feedBuffer.length > 50) this.feedBuffer = this.feedBuffer.slice(-50);
    for (const cb of this.feedSubs) cb(e);
  }

  private requireUser(): NonNullable<SaveState["user"]> {
    const u = this.state.user;
    if (!u) err("NO_SESSION", "No session. Get a name first.");
    return u;
  }

  private balanceBig(): bigint {
    return big(this.state.balance);
  }

  private credit(amount: bigint): void {
    this.state.balance = str(this.balanceBig() + amount);
    this.emitUser({ type: "balance", balance: this.state.balance });
  }

  private debit(amount: bigint, what: string): void {
    if (this.balanceBig() < amount) err("INSUFFICIENT_FUNDS", `Not enough $SHINY for ${what}.`);
    this.state.balance = str(this.balanceBig() - amount);
    this.emitUser({ type: "balance", balance: this.state.balance });
  }

  private burn(amount: bigint): void {
    this.state.burnedByPlayer = str(big(this.state.burnedByPlayer) + amount);
  }

  private toPd(amount: bigint): void {
    this.state.pdFromPlayer = str(big(this.state.pdFromPlayer) + amount);
  }

  private loc(slug: string): LocationConfig {
    const l = ALL_LOCATIONS.find((x) => x.slug === slug);
    if (!l) err("NO_SUCH_LOCATION", `No location "${slug}" in Shorefront City.`);
    return l;
  }

  /* ── v1.1 internals: Street Cred / jackpot / pass ───────────────── */

  /** Back-compat init for saves created before v1.1 (and first boot). */
  private ensureV11(now: number): void {
    if (this.state.user && !this.state.jackpot.winnableAt) {
      const anchor = this.state.firstLoginAt ? Date.parse(this.state.firstLoginAt) : now;
      this.state.jackpot.winnableAt = new Date(anchor + DEMO_V11.jackpotWinnableAfterRealMs).toISOString();
    }
    if (this.state.jackpot.history.length === 0) {
      this.state.jackpot.history.push({
        kind: "seed",
        handle: null,
        amount: str(JACKPOT.seedAmount),
        poolAfter: str(JACKPOT.seedAmount),
        at: this.state.firstLoginAt ?? new Date(now).toISOString(),
      });
    }
    // sync tier with holding on boot (instant upgrades; grace handled in advance)
    const raw = tierForHolding(big(this.state.simulatedHolding));
    if (this.tierRank(raw) >= this.tierRank(this.state.credTier)) {
      this.state.credTier = raw;
      this.state.credGraceUntil = null;
    }
  }

  private tierRank(t: CredTier): number {
    return ["none", "alley", "block", "district", "borough", "kingpin"].indexOf(t);
  }

  /** Effective tier — what perks are computed from. */
  private effectiveTier(): CredTier {
    return this.state.credTier;
  }

  private perks(): TierPerks {
    return TIER_DEFINITIONS[this.effectiveTier()].perks;
  }

  /** Run the anti-flicker grace machine (24h on mainnet, 2 real min in demo). */
  private tickCred(now: number): boolean {
    const raw = tierForHolding(big(this.state.simulatedHolding));
    const cur = this.state.credTier;
    if (this.tierRank(raw) >= this.tierRank(cur)) {
      // at-or-above the held tier — upgrades are instant, cancel any grace
      const changed = raw !== cur || this.state.credGraceUntil !== null;
      this.state.credTier = raw;
      this.state.credGraceUntil = null;
      return changed;
    }
    // below threshold: start (or run out) the downgrade grace window
    if (!this.state.credGraceUntil) {
      this.state.credGraceUntil = new Date(now + DEMO_V11.credGraceRealMs).toISOString();
      return true;
    }
    if (Date.parse(this.state.credGraceUntil) <= now) {
      this.state.credTier = raw;
      this.state.credGraceUntil = null;
      return true;
    }
    return false;
  }

  /** "All crews are out…" — names the first tier that adds a slot. */
  private slotLimitMessage(currentSlots: number): string {
    let t = nextTier(this.effectiveTier());
    while (t && TIER_DEFINITIONS[t].perks.missionSlots <= currentSlots) t = nextTier(t);
    if (!t) return "All crews are out. Wait for a job to land before pulling another.";
    const slots = TIER_DEFINITIONS[t].perks.missionSlots;
    return `All crews are out. Street Cred ${TIER_NAMES[t]} unlocks ${slots === 2 ? "a second job" : `${slots} concurrent jobs`}.`;
  }

  private credInfo(): CredInfo {
    const tier = this.effectiveTier();
    const held = big(this.state.simulatedHolding);
    const next = nextTier(tier);
    const shortfall = next ? TIER_DEFINITIONS[next].minHeld - held : null;
    return {
      tier,
      heldBalance: str(held),
      nextTier: next,
      shortfall: shortfall !== null ? str(shortfall > 0n ? shortfall : 0n) : null,
      graceUntil: this.state.credGraceUntil,
      perks: { ...this.perks() },
    };
  }

  private jackpotPublic(now: number): JackpotState {
    const j = this.state.jackpot;
    const winnableAt = j.winnableAt ?? new Date(now + DEMO_V11.jackpotWinnableAfterRealMs).toISOString();
    return {
      pool: j.pool,
      winnable: j.winnableAt !== null && Date.parse(j.winnableAt) <= now,
      winnableAt,
      seeded: str(JACKPOT.seedAmount),
      hits: j.hits,
      lastWinner: j.lastWinner ? { ...j.lastWinner } : null,
    };
  }

  private emitJackpot(now: number): void {
    if (this.jackpotSubs.size === 0) return;
    const s = this.jackpotPublic(now);
    for (const cb of this.jackpotSubs) cb(s);
  }

  private addToJackpot(amount: bigint): void {
    this.state.jackpot.pool = str(big(this.state.jackpot.pool) + amount);
  }

  /** Bot losses visibly pump the counter a few hundred SHINY per bucket. */
  private tickJackpotBots(now: number): boolean {
    const bucket = Math.floor(now / DEMO_V11.jackpotBotBucketMs);
    const j = this.state.jackpot;
    if (j.lastBotBucket === 0) {
      j.lastBotBucket = bucket;
      return false;
    }
    if (bucket <= j.lastBotBucket) return false;
    // accrue at most 30 buckets of catch-up so long-idle tabs don't explode the pool
    const from = Math.max(j.lastBotBucket + 1, bucket - 30);
    let added = 0n;
    for (let b = from; b <= bucket; b++) {
      const rng = makeRng(`jackpot-bots:${b}`);
      added += toBaseUnits(120 + Math.floor(rng() * 520));
    }
    j.lastBotBucket = bucket;
    if (added > 0n) {
      this.addToJackpot(added);
      this.emitJackpot(now);
      return true;
    }
    return false;
  }

  private gameDayIndex(now: number): number {
    const anchor = this.state.firstLoginAt ? Date.parse(this.state.firstLoginAt) : now;
    return Math.max(0, Math.floor((now - anchor) / GAME_DAY_REAL_MS));
  }

  private gameWeekIndex(now: number): number {
    const anchor = this.state.firstLoginAt ? Date.parse(this.state.firstLoginAt) : now;
    return Math.max(0, Math.floor((now - anchor) / GAME_WEEK_REAL_MS));
  }

  private rollDailyCaps(now: number): void {
    const day = this.gameDayIndex(now);
    if (day !== this.state.pass.xpDayIndex) {
      this.state.pass.xpDayIndex = day;
      this.state.pass.raffleXpToday = 0;
    }
  }

  /** Grant Heat XP (cap level 50) and emit the level-up event. */
  private addXp(amount: number): void {
    if (!this.state.user || amount <= 0) return;
    const p = this.state.pass;
    const before = Math.min(PASS.levels, Math.floor(p.xp / PASS.xpPerLevel));
    p.xp = Math.min(PASS.levels * PASS.xpPerLevel, p.xp + amount);
    const after = Math.min(PASS.levels, Math.floor(p.xp / PASS.xpPerLevel));
    if (after > before) this.emitUser({ type: "pass_level_up", level: after });
  }

  /** This week's 3 challenges (deterministic rotation by demo game-week). */
  private weekChallenges(now: number): Array<PassChallengeDef & { id: string; week: number }> {
    const week = this.gameWeekIndex(now);
    const rng = makeRng(`pass-challenges:s1:${week}`);
    const pool = [...PASS_CHALLENGE_POOL];
    const picked: PassChallengeDef[] = [];
    while (picked.length < PASS.challengesPerWeek && pool.length > 0) {
      const idx = Math.floor(rng() * pool.length);
      picked.push(...pool.splice(idx, 1));
    }
    return picked.map((c) => ({ ...c, id: `s1w${week}-${c.slug}`, week }));
  }

  /** Bump weekly-challenge progress for a game event; awards 150 XP once. */
  private trackChallenge(now: number, kind: PassChallengeDef["kind"], ref?: string, count = 1): void {
    if (!this.state.user) return;
    const p = this.state.pass;
    for (const c of this.weekChallenges(now)) {
      if (c.kind !== kind) continue;
      if (c.kind === "resolve_at" && c.ref !== ref) continue;
      const cur = p.challengeProgress[c.id] ?? 0;
      if (cur >= c.target) continue;
      const next = Math.min(c.target, cur + count);
      p.challengeProgress[c.id] = next;
      if (next >= c.target && !p.challengeAwarded.includes(c.id)) {
        p.challengeAwarded.push(c.id);
        this.addXp(PASS.xp.weeklyChallenge);
      }
    }
  }

  /** Borough+ perk: one free raffle ticket per week (idempotent per week). */
  private tickWeeklyRaffleGrant(now: number): boolean {
    if (!this.state.user) return false;
    if (this.perks().weeklyRaffleTickets <= 0) return false;
    const week = this.gameWeekIndex(now);
    if (week <= this.state.pass.lastRaffleGrantWeek) return false;
    this.state.pass.lastRaffleGrantWeek = week;
    const raffle = this.state.raffles.find((r) => r.state === "open");
    if (raffle) raffle.myTickets = (raffle.myTickets ?? 0) + this.perks().weeklyRaffleTickets;
    return true;
  }

  private char(id: string): Character {
    const c = this.state.characters.find((x) => x.id === id);
    if (!c) err("NO_SUCH_CHARACTER", "That raccoon doesn't answer to you.");
    return c;
  }

  /** Player patrol weight currently applied at a location. */
  private playerPatrolWeight(slug: string, now: number): number {
    return this.state.patrols
      .filter((p) => !p.settled && p.locationSlug === slug && Date.parse(p.shiftEndsAt) > now)
      .reduce((s, p) => s + p.weight, 0);
  }

  private totalWeight(slug: string, now: number): number {
    return ambientPatrolWeight(slug, now) + this.playerPatrolWeight(slug, now);
  }

  private sanitizeMission(m: StoredMission): Mission {
    return {
      id: m.id,
      locationSlug: m.locationSlug,
      characterId: m.characterId,
      stake: m.stake,
      state: m.state,
      serverSeedHash: m.serverSeedHash,
      clientSeed: m.clientSeed,
      effectiveTable: m.effectiveTable,
      insurance: m.insurance,
      bribed: m.bribed,
      startedAt: m.startedAt,
      resolvesAt: m.resolvesAt,
    };
  }

  /* ── the clock ──────────────────────────────────────────────────── */

  private advance(now: number): void {
    let dirty = false;

    // v1.1: cred grace machine, bot jackpot accrual, weekly raffle grant
    this.rollDailyCaps(now);
    if (this.tickCred(now)) dirty = true;
    if (this.tickJackpotBots(now)) dirty = true;
    if (this.tickWeeklyRaffleGrant(now)) dirty = true;

    // live ambient feed
    const bucket = bucketIndex(now);
    if (bucket > this.state.lastSeenBucket) {
      for (let i = this.state.lastSeenBucket + 1; i <= bucket; i++) {
        const ev = feedEventForBucket(i);
        if (ev && this.feedSubs.size > 0) this.emitFeed(ev);
        else if (ev) this.feedBuffer.push(ev);
      }
      this.state.lastSeenBucket = bucket;
      dirty = true;
    }

    // mission resolutions
    for (const m of this.state.missions) {
      if (m.state === "active" && Date.parse(m.resolvesAt) <= now) {
        this.resolve(m);
        dirty = true;
      }
    }

    // jail releases
    for (const c of this.state.characters) {
      if (c.status === "jailed" && c.jailedUntil && Date.parse(c.jailedUntil) <= now) {
        c.status = "idle";
        c.jailedUntil = null;
        this.emitUser({ type: "jail_released", characterId: c.id, characterName: c.name });
        dirty = true;
      }
    }

    // patrol shift settlement
    for (const p of this.state.patrols) {
      if (!p.settled && Date.parse(p.shiftEndsAt) <= now) {
        this.settlePatrol(p, now);
        dirty = true;
      }
    }

    // raffle draws
    for (const r of this.state.raffles) {
      if (r.state === "open" && Date.parse(r.drawsAt) <= now) {
        this.drawRaffle(r);
        dirty = true;
      }
    }

    // ambient buyers for the player's market listings
    for (const l of this.state.myListings) {
      if (l.state === "active" && this.botWantsToBuy(l, now)) {
        this.settleBotPurchase(l);
        dirty = true;
      }
    }

    if (dirty) this.save();
  }

  private resolve(m: StoredMission): void {
    const roll = rollFromSeeds(m.serverSeed, m.clientSeed, m.id);
    const row = resolveMission(m.effectiveTable, roll);
    const stake = big(m.stake);
    const payout = computePayout(stake, row);
    const detail: Record<string, unknown> = { roll, multiplierBps: row.multiplierBps ?? null };
    const character = m.characterId ? this.state.characters.find((c) => c.id === m.characterId) : undefined;
    const handle = this.state.user?.handle ?? "you";
    const locName = this.loc(m.locationSlug).name;

    switch (row.outcome) {
      case "win":
      case "jackpot": {
        this.credit(payout);
        let totalPaid = payout;
        // v1.1: a `jackpot` roll at The Mint after winnable-at ALSO wins the
        // public pool (minus the 10% reset floor) — same roll, same commit.
        if (row.outcome === "jackpot" && m.locationSlug === "the-mint") {
          const now = Date.now();
          const j = this.state.jackpot;
          if (j.winnableAt && Date.parse(j.winnableAt) <= now) {
            const pool = big(j.pool);
            const floor = applyBps(pool, JACKPOT.resetFloorBps);
            const poolPayout = pool - floor;
            if (poolPayout > 0n) {
              this.credit(poolPayout);
              totalPaid += poolPayout;
              j.pool = str(floor);
              j.hits += 1;
              j.lastWinner = { handle, amount: str(poolPayout), at: new Date(now).toISOString() };
              j.history.push({
                kind: "win", handle, amount: str(poolPayout), poolAfter: str(floor),
                at: new Date(now).toISOString(),
              });
              detail.jackpotPool = str(poolPayout);
              this.emitFeed({
                id: `vault-${m.id}`, type: "jackpot", locationSlug: m.locationSlug, actor: handle,
                amountBand: formatBand(poolPayout),
                message: `THE VAULT FALLS — ${handle} emptied The Mint's pool for ${Number(poolPayout / 1_000_000n).toLocaleString("en-US")} $SHINY`,
                at: new Date(now).toISOString(),
              });
              this.emitJackpot(now);
            }
          }
        }
        const profit = totalPaid - stake;
        this.state.stats.totalEarned = str(big(this.state.stats.totalEarned) + (profit > 0n ? profit : 0n));
        if (totalPaid > big(this.state.stats.biggestHeist)) this.state.stats.biggestHeist = str(totalPaid);
        this.emitFeed({
          id: `you-${m.id}`,
          type: row.outcome,
          locationSlug: m.locationSlug,
          actor: handle,
          multiplierBps: row.multiplierBps,
          amountBand: formatBand(totalPaid),
          message:
            row.outcome === "jackpot"
              ? `JACKPOT — ${handle} cracked ${locName} for ${((row.multiplierBps ?? 0) / 10_000).toFixed(1)}×`
              : `${handle} hit ${((row.multiplierBps ?? 0) / 10_000).toFixed(1)}× at ${locName}`,
          at: new Date().toISOString(),
        });
        break;
      }
      case "nothing":
        this.credit(stake);
        break;
      case "arrest": {
        this.credit(stake);
        if (character) {
          character.status = "jailed";
          character.jailedUntil = new Date(Date.now() + gameHoursToRealMs(POLICY.jailHours)).toISOString();
        }
        this.emitFeed({
          id: `you-${m.id}`, type: "arrest", locationSlug: m.locationSlug, actor: handle,
          message: `${handle} got booked at ${locName} — 24h in the tank`,
          at: new Date().toISOString(),
        });
        break;
      }
      case "confiscation": {
        // v1.1: confiscations are loss flows like rekts — same 3-way splitLoss
        // routing as the live engine (settle.ts), or APR/jackpot accrual drift.
        const pdShare = applyBps(stake, POLICY.lossSplit.pdBps);
        const jpShare = applyBps(stake, POLICY.lossSplit.jackpotBps);
        this.burn(stake - pdShare - jpShare);
        this.toPd(pdShare);
        this.addToJackpot(jpShare);
        this.emitJackpot(Date.now());
        this.state.stats.totalConfiscated = str(big(this.state.stats.totalConfiscated) + stake);
        this.emitFeed({
          id: `you-${m.id}`, type: "confiscation", locationSlug: m.locationSlug, actor: handle,
          amountBand: formatBand(stake),
          message: `PD confiscated ${handle}'s stake at ${locName}`,
          at: new Date().toISOString(),
        });
        break;
      }
      case "rekt_items":
      case "rekt_character": {
        // v1.1 loss routing (POLICY.lossSplit): 94.5% burn / 0.5% PD / 5% jackpot,
        // conservation-safe — burn takes the exact remainder.
        const pd = applyBps(stake, POLICY.lossSplit.pdBps);
        const jackpotShare = applyBps(stake, POLICY.lossSplit.jackpotBps);
        this.burn(stake - pd - jackpotShare);
        this.toPd(pd);
        this.addToJackpot(jackpotShare);
        this.emitJackpot(Date.now());
        if (character) {
          if (character.cosmetics.length > 0) {
            const idx = Math.floor(roll * character.cosmetics.length) % character.cosmetics.length;
            character.cosmetics = character.cosmetics.filter((_, i) => i !== idx);
          }
          if (row.outcome === "rekt_character") {
            if (m.insurance) {
              detail.insuranceSaved = true;
            } else {
              character.status = "dead";
            }
          }
        }
        this.emitFeed({
          id: `you-${m.id}`, type: "rekt", locationSlug: m.locationSlug, actor: handle,
          message: `${handle} didn't make it out of ${locName}`,
          at: new Date().toISOString(),
        });
        break;
      }
    }

    if (character && character.status === "on_mission") character.status = "idle";
    m.state = "resolved";
    m.result = {
      missionId: m.id,
      outcome: row.outcome,
      payout: str(payout),
      serverSeed: m.serverSeed,
      detail,
    };
    this.state.stats.missionCount += 1;

    // v1.1 season pass: Heat XP + weekly challenge progress (play is play —
    // mission XP lands win or lose)
    const now = Date.now();
    this.rollDailyCaps(now);
    this.addXp(PASS.xp.missionResolved);
    const day = this.gameDayIndex(now);
    if (this.state.pass.firstMissionDayIndex !== day) {
      this.state.pass.firstMissionDayIndex = day;
      this.addXp(PASS.xp.dailyFirstMission);
    }
    this.trackChallenge(now, "resolve_at", m.locationSlug);
    const locCfg = this.loc(m.locationSlug);
    if (locCfg.rektCapable && row.outcome !== "rekt_items" && row.outcome !== "rekt_character") {
      this.trackChallenge(now, "survive_rekt");
    }
    if (row.outcome === "win" || row.outcome === "jackpot") this.trackChallenge(now, "wins");

    this.emitUser({ type: "mission_resolved", mission: this.sanitizeMission(m), result: m.result });
  }

  private settlePatrol(p: StoredPatrol, now: number): void {
    p.settled = true;
    const character = this.state.characters.find((c) => c.id === p.characterId);
    if (character && character.status === "on_patrol") {
      character.status = "idle";
      character.patrolEndsAt = null;
    }
    const rng = makeRng(`bounty:${p.id}`);
    const flow = CONF_FLOW[p.locationSlug] ?? 500;
    const share = p.weight / Math.max(1, this.totalWeight(p.locationSlug, now) + 0.5);
    const whole = Math.floor(
      flow * POLICY.patrolShiftHours * (POLICY.patrolBountyBps / 10_000) * share * (0.7 + rng() * 0.6),
    );
    const bounty = toBaseUnits(whole);
    this.credit(bounty);
    this.state.stats.houndEarned = str(big(this.state.stats.houndEarned) + bounty);
    this.addXp(PASS.xp.patrolCompleted);
    this.emitUser({
      type: "patrol_ended",
      patrol: {
        id: p.id, characterId: p.characterId, characterName: p.characterName,
        locationSlug: p.locationSlug, weight: p.weight, shiftEndsAt: p.shiftEndsAt,
      },
      bounty: str(bounty),
    });
  }

  private drawRaffle(r: StoredRaffle): void {
    const mine = r.myTickets ?? 0;
    const bots = botTicketsSold(Date.parse(r.opensAt), Date.parse(r.drawsAt));
    const total = bots + mine;
    const roll = rollFromSeeds(r.serverSeed, "raffle", r.id);
    const winnerIdx = Math.min(total - 1, Math.floor(roll * total));
    const won = mine > 0 && winnerIdx >= bots;
    const handle = this.state.user?.handle ?? "you";
    let winner: string;
    if (won) {
      winner = handle;
      if (r.type === "recruitment") {
        this.grantCharacter("raccoon", `Raffle Recruit`);
      } else {
        const slug = typeof r.prize.cosmeticSlug === "string" ? r.prize.cosmeticSlug : "hat-crown";
        this.state.inventory.push(slug);
      }
    } else {
      const rng = makeRng(`raffle-winner:${r.id}`);
      const bot = botListings(Date.parse(r.drawsAt))[0];
      winner = bot ? bot.seller : `Citizen #${Math.floor(rng() * 900 + 100)}`;
    }
    r.state = "drawn";
    r.winners = [winner];
    this.emitFeed({
      id: `raffle-${r.id}`, type: "raffle", actor: winner,
      message: `${winner} won the ${r.title}`,
      at: new Date().toISOString(),
    });
    this.emitUser({ type: "raffle_drawn", raffle: this.publicRaffle(r), won });
  }

  private botWantsToBuy(l: Listing, now: number): boolean {
    const c = l.character;
    if (!c) return false;
    const invested = c.stats.stealth + c.stats.muscle + c.stats.luck + c.stats.reputation - 4;
    const fair = toBaseUnits(25_000 + invested * 2_500);
    if (big(l.price) > (fair * 14n) / 10n) return false;
    // ~ once per 90s when fairly priced
    return makeRng(`botbuy:${l.id}:${Math.floor(now / 1000)}`)() < 1 / 90;
  }

  private settleBotPurchase(l: Listing): void {
    const price = big(l.price);
    const fee = (price * BigInt(POLICY.marketplaceFeeBps)) / 10_000n;
    const net = price - fee;
    this.burn(fee / 2n);
    this.state.treasuryFromPlayer = str(big(this.state.treasuryFromPlayer) + (fee - fee / 2n));
    this.credit(net);
    l.state = "sold";
    this.state.characters = this.state.characters.filter((c) => c.id !== l.refId);
    const rng = makeRng(`buyer:${l.id}`);
    const buyer = botListings(Date.now())[Math.floor(rng() * 3)]?.seller ?? "Velvet Knuckles";
    this.emitFeed({
      id: `sold-${l.id}`, type: "win", actor: buyer,
      message: `${buyer} bought ${l.character?.name ?? "a recruit"} off the market`,
      at: new Date().toISOString(),
    });
    this.emitUser({ type: "listing_sold", listing: l, net: str(net) });
  }

  private grantCharacter(faction: "raccoon" | "bloodhound", baseName: string): Character {
    const dna = sha256Hex(generateServerSeed());
    const rng = makeRng(dna);
    const name = `${baseName} ${STARTER_NAMES[Math.floor(rng() * STARTER_NAMES.length)] ?? "Dusty"}`;
    const stats: CharacterStats =
      faction === "raccoon"
        ? { stealth: 1, muscle: 1, luck: 1, reputation: 1 }
        : { stealth: 1, muscle: 2, luck: 1, reputation: 2 };
    const c: Character = {
      id: uuid(),
      name,
      faction,
      level: 1,
      stats,
      status: "idle",
      stationedAt: null,
      jailedUntil: null,
      patrolEndsAt: null,
      nftMint: null,
      inGame: true,
      lastClaimedAt: null,
      dna,
      cosmetics: [],
    };
    this.state.characters.push(c);
    return c;
  }

  private grantFragmentTickets(): void {
    const per = LOCAL_POLICY.loginFragmentsPerTicket;
    while (this.state.stats.loginFragments >= per) {
      this.state.stats.loginFragments -= per;
      this.state.stats.freeTicketsClaimed += 1;
      const raffle = this.state.raffles.find((r) => r.state === "open" && r.type === "recruitment");
      if (raffle) raffle.myTickets = (raffle.myTickets ?? 0) + 1;
    }
  }

  private publicRaffle(r: StoredRaffle): Raffle {
    const now = Date.now();
    const bots = botTicketsSold(Date.parse(r.opensAt), Math.min(now, Date.parse(r.drawsAt)));
    const { serverSeed: _seed, ...rest } = r;
    return { ...rest, ticketsSold: bots + (r.myTickets ?? 0) };
  }

  /* ── auth ───────────────────────────────────────────────────────── */

  async getMe(): Promise<MeResponse> {
    const u = this.requireUser();
    const locked = this.state.missions
      .filter((m) => m.state === "active")
      .reduce((s, m) => s + big(m.stake), 0n);
    return {
      id: u.id,
      handle: u.handle,
      isGuest: true,
      wallets: [],
      balance: this.state.balance,
      lockedBalance: str(locked),
      tosAcceptedVersion: u.tosAcceptedVersion,
      flags: ["beta"],
      role: "player",
      createdAt: u.createdAt,
      cred: this.credInfo(),
    };
  }

  async guestLogin(handle: string): Promise<MeResponse> {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) {
      err("BAD_HANDLE", "3–20 letters, numbers or underscores. Aliases only.");
    }
    const now = new Date();
    this.state = defaultSave();
    this.state.user = {
      id: uuid(),
      handle,
      createdAt: now.toISOString(),
      tosAcceptedVersion: TOS_VERSION,
    };
    this.state.balance = str(LOCAL_POLICY.starterBalance);
    this.state.firstLoginAt = now.toISOString();
    this.state.lastSeenBucket = bucketIndex(now.getTime());
    this.state.stats.loginFragments = 1;

    // v1.1: the vault opens 15 real minutes after first login (beta time);
    // the pool itself has been accruing since the 2M seed.
    this.state.jackpot.winnableAt = new Date(
      now.getTime() + DEMO_V11.jackpotWinnableAfterRealMs,
    ).toISOString();
    if (this.state.jackpot.history.length === 0) {
      this.state.jackpot.history.push({
        kind: "seed", handle: null,
        amount: str(JACKPOT.seedAmount), poolAfter: str(JACKPOT.seedAmount),
        at: now.toISOString(),
      });
    }
    this.state.credTier = tierForHolding(big(this.state.simulatedHolding));

    // starter raccoon, dna from the handle
    const dna = sha256Hex(handle);
    const rng = makeRng(dna);
    this.state.characters.push({
      id: uuid(),
      name: STARTER_NAMES[Math.floor(rng() * STARTER_NAMES.length)] ?? "Dusty",
      faction: "raccoon",
      level: 1,
      stats: { stealth: 1, muscle: 1, luck: 1, reputation: 1 },
      status: "idle",
      stationedAt: null,
      jailedUntil: null,
      patrolEndsAt: null,
      nftMint: null,
      inGame: true,
      lastClaimedAt: null,
      dna,
      cosmetics: [],
    });

    // raffles: one drawing soon so testers see a draw, one slower cosmetic one
    const mkRaffle = (
      id: string, type: "recruitment" | "cosmetic", title: string,
      prize: Record<string, unknown>, drawInMin: number,
    ): StoredRaffle => {
      const seed = generateServerSeed();
      return {
        id, type, title, prize,
        ticketPrice: str(raffleTicketPrice()),
        ticketsSold: 0, maxTickets: null, myTickets: 0,
        opensAt: now.toISOString(),
        drawsAt: new Date(now.getTime() + drawInMin * 60_000).toISOString(),
        state: "open",
        serverSeedHash: commitHash(seed),
        winners: null,
        serverSeed: seed,
      };
    };
    this.state.raffles.push(
      mkRaffle("raffle-recruit-1", "recruitment", "Midnight Recruitment Raffle", { faction: "raccoon" }, 10),
      mkRaffle("raffle-crown-1", "cosmetic", "Dumpster Crown Raffle", { cosmeticSlug: "hat-crown" }, 35),
    );

    this.state.bankHistory.push({
      id: uuid(), kind: "faucet", amount: str(LOCAL_POLICY.starterBalance), fee: "0",
      state: "credited", note: "Welcome to Shorefront City — beta starter grant", at: now.toISOString(),
    });
    this.save();
    return this.getMe();
  }

  async logout(): Promise<void> {
    this.state = defaultSave();
    this.save();
  }

  /* ── world ──────────────────────────────────────────────────────── */

  async getLocations(): Promise<LocationLive[]> {
    const now = Date.now();
    // The Penthouse Job is in the location data only for Kingpin (specs/01)
    const visible = this.perks().penthouseAccess ? ALL_LOCATIONS : SEASON1_LOCATIONS;
    return visible.map((l) => {
      const weight = this.totalWeight(l.slug, now);
      return {
        ...l,
        heat: heatAt(l.slug, now, this.playerPatrolWeight(l.slug, now)),
        playersActive: playersActiveWithMine(l.slug, now, this.state),
        effectiveTable: applyPatrolModifiers(l.table, weight, l),
      };
    });
  }

  /* ── missions ───────────────────────────────────────────────────── */

  async startMission(req: MissionStartRequest): Promise<Mission> {
    this.requireUser();
    const now = Date.now();
    this.advance(now);
    const loc = this.loc(req.locationSlug);
    const stake = big(req.stake);
    if (stake < big(loc.minStake)) err("STAKE_TOO_LOW", `Minimum stake here is ${loc.minStake} base units.`);
    if (stake > big(loc.maxStake)) err("STAKE_TOO_HIGH", "That's more than this place can hold.");

    // v1.1 Street Cred gates: penthouse access + concurrent mission slots
    const perks = this.perks();
    if (loc.slug === PENTHOUSE_LOCATION.slug && !perks.penthouseAccess) {
      err("PENTHOUSE_LOCKED", "The doorman doesn't know you. The Penthouse Job is Kingpin territory — hold 5,000,000 $SHINY.");
    }
    const activeCount = this.state.missions.filter((x) => x.state === "active").length;
    if (activeCount >= perks.missionSlots) {
      err("SLOT_LIMIT", this.slotLimitMessage(perks.missionSlots));
    }

    let stats: CharacterStats = ZERO_STATS;
    let character: Character | undefined;
    if (req.characterId) {
      character = this.char(req.characterId);
      if (character.status !== "idle") err("CHARACTER_BUSY", `${character.name} is busy: ${character.status}.`);
      if (character.faction === "bloodhound") err("WRONG_FACTION", "Hounds don't rob. Hounds collect.");
      stats = character.stats;
    } else {
      if (!loc.freeTierAllowed) err("CHARACTER_REQUIRED", "This job needs a crew member.");
      if (!perks.freeTierAccess)
        err("HOLDING_GATE", "Free tier needs Alley cred — 10,000 $SHINY held in your wallet. (Beta: set your simulated holding on the Street Cred page.)");
      if (stake > POLICY.freeTierMaxStake) err("FREE_TIER_CAP", "Free tier caps at 5,000 $SHINY.");
      const last = this.state.stats.lastFreeTierAt;
      if (last && now - Date.parse(last) < gameHoursToRealMs(POLICY.freeTierCooldownHours)) {
        err("FREE_TIER_COOLDOWN", "The free job runs every 8 hours. Patience is a heist skill.");
      }
      this.state.stats.lastFreeTierAt = new Date(now).toISOString();
    }

    this.debit(stake, "the stake"); // escrow

    const weight = this.totalWeight(loc.slug, now);
    const withStats = applyStatModifiers(loc.table, stats);
    const effectiveTable = applyPatrolModifiers(withStats, weight, loc);

    const serverSeed = generateServerSeed();
    const m: StoredMission = {
      id: uuid(),
      locationSlug: loc.slug,
      characterId: character?.id ?? null,
      stake: str(stake),
      state: "active",
      serverSeedHash: commitHash(serverSeed),
      clientSeed: req.clientSeed && req.clientSeed.length > 0 ? req.clientSeed : sha256Hex(uuid()).slice(0, 16),
      effectiveTable,
      insurance: false,
      bribed: false,
      startedAt: new Date(now).toISOString(),
      resolvesAt: new Date(now + gameHoursToRealMs(loc.durationHours)).toISOString(),
      serverSeed,
    };
    if (character) character.status = "on_mission";
    this.state.missions.push(m);
    this.save();
    return this.sanitizeMission(m);
  }

  async getMissions(): Promise<MissionsResponse> {
    this.advance(Date.now());
    const active = this.state.missions.filter((m) => m.state === "active").map((m) => this.sanitizeMission(m));
    const resolved = this.state.missions
      .filter((m): m is StoredMission & { result: MissionResult } => m.state === "resolved" && !!m.result)
      .map((m) => ({ ...this.sanitizeMission(m), result: m.result }))
      .reverse();
    return { active, resolved };
  }

  async getMission(id: string): Promise<Mission | ResolvedMission> {
    this.advance(Date.now());
    const m = this.state.missions.find((x) => x.id === id);
    if (!m) err("NO_SUCH_MISSION", "No record of that job. Smart.");
    return m.result ? { ...this.sanitizeMission(m), result: m.result } : this.sanitizeMission(m);
  }

  async buyInsurance(id: string, opts?: { useVoucher?: boolean }): Promise<Mission> {
    const m = this.state.missions.find((x) => x.id === id);
    if (!m) err("NO_SUCH_MISSION", "No record of that job.");
    if (m.state !== "active") err("MISSION_DONE", "Too late for paperwork.");
    if (m.insurance) err("ALREADY_INSURED", "Already covered.");
    const loc = this.loc(m.locationSlug);
    if (!loc.rektCapable) err("NOT_REKT_CAPABLE", "Nothing here can kill you. Save the premium.");
    if (opts?.useVoucher) {
      // v1.1 season pass voucher: covers the job, no premium, no burn
      if (this.state.pass.vouchers <= 0) err("NO_VOUCHERS", "No insurance vouchers left. Earn them on the Season Pass.");
      this.state.pass.vouchers -= 1;
    } else {
      const price = insurancePrice(big(m.stake), loc);
      this.debit(price, "insurance");
      this.burn(price);
    }
    m.insurance = true;
    this.save();
    return this.sanitizeMission(m);
  }

  async bribe(id: string): Promise<Mission> {
    const m = this.state.missions.find((x) => x.id === id);
    if (!m) err("NO_SUCH_MISSION", "No record of that job.");
    if (m.state !== "active") err("MISSION_DONE", "The patrol already made up its mind.");
    if (m.bribed) err("ALREADY_BRIBED", "One envelope per job.");
    const loc = this.loc(m.locationSlug);
    const price = (big(m.stake) * BigInt(LOCAL_POLICY.bribePriceBps)) / 10_000n;
    this.debit(price, "the bribe");
    const burnShare = (price * BigInt(POLICY.bribeSplit.burnBps)) / 10_000n;
    this.burn(burnShare);
    this.toPd(price - burnShare);
    const stats = m.characterId ? this.char(m.characterId).stats : ZERO_STATS;
    const prePatrol = applyStatModifiers(loc.table, stats);
    m.effectiveTable = applyBribe(m.effectiveTable, prePatrol);
    m.bribed = true;
    this.save();
    return this.sanitizeMission(m);
  }

  async verifyMission(id: string): Promise<MissionVerify> {
    const m = this.state.missions.find((x) => x.id === id);
    if (!m) err("NO_SUCH_MISSION", "No record of that job.");
    if (m.state !== "resolved" || !m.result) err("NOT_RESOLVED", "Seeds reveal after resolution. That's the point.");
    const roll = rollFromSeeds(m.serverSeed, m.clientSeed, m.id);
    return {
      missionId: m.id,
      serverSeedHash: m.serverSeedHash,
      serverSeed: m.serverSeed,
      clientSeed: m.clientSeed,
      algorithm: PROVABLY_FAIR_ALGORITHM,
      table: m.effectiveTable,
      roll,
      outcome: resolveMission(m.effectiveTable, roll).outcome,
    };
  }

  /* ── characters ─────────────────────────────────────────────────── */

  async getCharacters(): Promise<Character[]> {
    this.advance(Date.now());
    return this.state.characters.map((c) => ({ ...c }));
  }

  async station(id: string, slug: string | null): Promise<Character> {
    const c = this.char(id);
    if (c.status !== "idle") err("CHARACTER_BUSY", `${c.name} is ${c.status}.`);
    if (slug) this.loc(slug);
    if (c.stationedAt && c.lastClaimedAt) {
      // auto-claim accrued idle before moving
      await this.claimIdle(id).catch(() => undefined);
    }
    c.stationedAt = slug;
    c.lastClaimedAt = slug ? new Date().toISOString() : null;
    this.save();
    return { ...c };
  }

  async claimIdle(id: string): Promise<{ amount: string }> {
    const c = this.char(id);
    if (!c.stationedAt || !c.lastClaimedAt) err("NOT_STATIONED", `${c.name} isn't stationed anywhere.`);
    const loc = this.loc(c.stationedAt);
    const hours = Math.min(
      realMsToGameHours(Date.now() - Date.parse(c.lastClaimedAt)),
      POLICY.idleClaimCapHours,
    );
    const rate = idleRatePerHour(loc, c.level);
    const amount = (rate * BigInt(Math.floor(hours * 1000))) / 1000n;
    if (amount <= 0n) err("NOTHING_ACCRUED", "Nothing in the tip jar yet.");
    c.lastClaimedAt = new Date().toISOString();
    this.credit(amount);
    this.save();
    return { amount: str(amount) };
  }

  async bail(id: string): Promise<Character> {
    const c = this.char(id);
    if (c.status !== "jailed") err("NOT_JAILED", `${c.name} is a free mammal.`);
    // v1.1: Block+ cred shaves the bail price (status perk, not yield)
    const base = bailPrice();
    const price = base - applyBps(base, this.perks().bailDiscountBps);
    this.debit(price, "bail");
    const { burn, pd } = splitBail(price);
    this.burn(burn);
    this.toPd(pd);
    c.status = "idle";
    c.jailedUntil = null;
    this.addXp(PASS.xp.bailPaid);
    this.trackChallenge(Date.now(), "bails");
    this.save();
    return { ...c };
  }

  async upgrade(id: string, stat: StatKey): Promise<Character> {
    const c = this.char(id);
    if (c.status === "dead") err("DEAD", "The dead don't train.");
    const current = c.stats[stat];
    if (current >= POLICY.statLevelCapS1) err("STAT_CAPPED", `Season 1 caps stats at ${POLICY.statLevelCapS1}.`);
    const cost = upgradeCostFor(current);
    this.debit(cost, "the upgrade");
    this.burn(cost);
    c.stats = { ...c.stats, [stat]: current + 1 };
    const points = c.stats.stealth + c.stats.muscle + c.stats.luck + c.stats.reputation;
    c.level = Math.max(1, 1 + Math.floor((points - 4) / 2));
    this.emitFeed({
      id: `burn-${uuid()}`, type: "burn", actor: this.state.user?.handle,
      message: `${this.state.user?.handle ?? "Someone"} burned ${Number(cost / 1_000_000n).toLocaleString("en-US")} $SHINY on training`,
      at: new Date().toISOString(),
    });
    this.save();
    return { ...c };
  }

  async rename(id: string, name: string): Promise<Character> {
    const c = this.char(id);
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 24) err("BAD_NAME", "2–24 characters. Make it memorable.");
    this.debit(SINKS.nameChange, "the name change");
    this.burn(SINKS.nameChange);
    c.name = trimmed;
    this.save();
    return { ...c };
  }

  /** Next limited wave timing: cycles every 20 real minutes from first login. */
  private waveTimes(now: number): { publicOpensAt: number; earlyOpensAt: number; closesAt: number } {
    const anchor = this.state.firstLoginAt ? Date.parse(this.state.firstLoginAt) : now;
    const cycle = DEMO_V11.mintWaveCycleRealMs;
    const k = Math.floor((now - anchor) / cycle) + 1;
    const publicOpensAt = anchor + k * cycle;
    // District+ get in `mintEarlyAccessHours` game-hours early (1 game h = 1 real min)
    const earlyOpensAt = publicOpensAt - gameHoursToRealMs(this.perks().mintEarlyAccessHours);
    return { publicOpensAt, earlyOpensAt, closesAt: publicOpensAt + cycle / 2 };
  }

  async getMintEvents(): Promise<MintEvent[]> {
    const now = Date.now();
    const season = this.state.firstLoginAt ?? new Date(now).toISOString();
    const mk = (id: string, faction: "raccoon" | "bloodhound", supply: number): MintEvent => {
      const taken = botMintTaken(faction, now) + (this.state.playerMints[id] ?? 0);
      const remaining = Math.max(0, supply - taken);
      return {
        id, faction,
        price: str(mintPrice(faction)),
        supply, remaining,
        opensAt: season,
        closesAt: new Date(now + 60 * 86_400_000).toISOString(),
        state: remaining === 0 ? "soldout" : "open",
      };
    };
    // v1.1: a recurring limited wave whose door opens early for District+
    const { publicOpensAt, earlyOpensAt, closesAt } = this.waveTimes(now);
    const open = now >= (this.perks().mintEarlyAccessHours > 0 ? earlyOpensAt : publicOpensAt);
    const waveKey = `${MINT_WAVE}-${publicOpensAt}`;
    const taken = (this.state.playerMints[waveKey] ?? 0) + (open ? Math.floor((now - earlyOpensAt) / 45_000) : 0);
    const wave: MintEvent = {
      id: waveKey,
      faction: "raccoon",
      price: str(mintPrice("raccoon")),
      supply: 50,
      remaining: Math.max(0, 50 - taken),
      opensAt: new Date(publicOpensAt).toISOString(),
      closesAt: new Date(closesAt).toISOString(),
      state: taken >= 50 ? "soldout" : open ? "open" : "upcoming",
    };
    return [wave, mk(MINT_RACCOON, "raccoon", 500), mk(MINT_BLOODHOUND, "bloodhound", 50)];
  }

  async mint(eventId: string): Promise<Character> {
    const events = await this.getMintEvents();
    const ev = events.find((e) => e.id === eventId);
    if (!ev) err("NO_SUCH_MINT", "That mint wave doesn't exist.");
    if (ev.state === "upcoming") {
      err("WAVE_NOT_OPEN", this.perks().mintEarlyAccessHours > 0
        ? "Your early door isn't open yet. Watch the countdown."
        : "Wave isn't open yet. District cred gets in an hour early.");
    }
    if (ev.state !== "open" || ev.remaining <= 0) err("SOLD_OUT", "Wave's gone. Watch the feed for the next one.");
    if (ev.faction === "bloodhound") {
      const hounds = this.state.characters.filter((c) => c.faction === "bloodhound" && c.status !== "dead").length;
      const living = this.state.characters.filter((c) => c.status !== "dead").length;
      // 10% cap, but everyone gets their first hound
      if (hounds > 0 && (hounds + 1) / (living + 1) > POLICY.bloodhoundCapBps / 10_000 + 0.5) {
        err("HOUND_CAP", "The force keeps a 10% headcount cap.");
      }
    }
    const price = big(ev.price);
    this.debit(price, "the mint");
    this.burn(price);
    this.state.playerMints[eventId] = (this.state.playerMints[eventId] ?? 0) + 1;
    const c = this.grantCharacter(ev.faction === "raccoon" ? "raccoon" : "bloodhound",
      ev.faction === "raccoon" ? "Recruit" : "Officer");
    this.emitFeed({
      id: `mint-${c.id}`, type: "mint", actor: this.state.user?.handle,
      message: `${this.state.user?.handle ?? "Someone"} minted a ${ev.faction} — ${Number(price / 1_000_000n).toLocaleString("en-US")} $SHINY burned forever`,
      at: new Date().toISOString(),
    });
    this.save();
    return { ...c };
  }

  /* ── pvp ────────────────────────────────────────────────────────── */

  async startPatrol(characterId: string, slug: string): Promise<Patrol> {
    const c = this.char(characterId);
    const loc = this.loc(slug);
    if (c.faction !== "bloodhound") err("WRONG_FACTION", "Raccoons don't get badges.");
    if (c.status !== "idle") err("CHARACTER_BUSY", `${c.name} is ${c.status}.`);
    const now = Date.now();
    const weight = 1 + c.stats.reputation * STAT_EFFECTS.reputationWeightPerLevel;
    if (this.totalWeight(slug, now) + weight > loc.patrolWeightCap) {
      err("PATROL_FULL", `${loc.name} is saturated with patrols. Pick a quieter beat.`);
    }
    const p: StoredPatrol = {
      id: uuid(),
      characterId: c.id,
      characterName: c.name,
      locationSlug: slug,
      weight,
      startedAt: new Date(now).toISOString(),
      shiftEndsAt: new Date(now + gameHoursToRealMs(POLICY.patrolShiftHours)).toISOString(),
      settled: false,
    };
    c.status = "on_patrol";
    c.patrolEndsAt = p.shiftEndsAt;
    this.state.patrols.push(p);
    this.emitFeed({
      id: `patrol-${p.id}`, type: "patrol", locationSlug: slug, actor: c.name,
      message: `${c.name} started a patrol shift at ${loc.name}`,
      at: new Date().toISOString(),
    });
    this.save();
    return {
      id: p.id, characterId: p.characterId, characterName: p.characterName,
      locationSlug: p.locationSlug, weight: p.weight, shiftEndsAt: p.shiftEndsAt,
    };
  }

  async getPatrols(): Promise<Patrol[]> {
    this.advance(Date.now());
    return this.state.patrols
      .filter((p) => !p.settled)
      .map((p) => ({
        id: p.id, characterId: p.characterId, characterName: p.characterName,
        locationSlug: p.locationSlug, weight: p.weight, shiftEndsAt: p.shiftEndsAt,
      }));
  }

  async getPvpStats(): Promise<PvpStats> {
    const now = Date.now();
    const base = syntheticPublicStats(now, big(this.state.burnedByPlayer), big(this.state.treasuryFromPlayer));
    const pool = toBaseUnits(2_400_000) + big(this.state.pdFromPlayer);
    return {
      pdPool: str(pool),
      trailingApr: base.pdApr,
      bloodhoundCount: 47 + this.state.characters.filter((c) => c.faction === "bloodhound").length,
      livingCharacters: 1_240 + this.state.characters.filter((c) => c.status !== "dead").length,
      topHounds: botLeaderboard("hounds", now).slice(0, 5).map((e) => ({
        name: e.handle,
        reputation: 4 + (e.rank % 6),
        earned: e.value,
      })),
    };
  }

  /* ── bank ───────────────────────────────────────────────────────── */

  async deposit(_amount: string): Promise<{ amount: string }> {
    this.requireUser();
    const now = Date.now();
    const last = this.state.stats.lastFaucetAt;
    if (last && now - Date.parse(last) < gameHoursToRealMs(LOCAL_POLICY.faucetCooldownGameHours)) {
      err("FAUCET_COOLDOWN", "The faucet drips once a day (24 game hours).");
    }
    this.state.stats.lastFaucetAt = new Date(now).toISOString();
    this.credit(LOCAL_POLICY.faucetAmount);
    this.state.bankHistory.unshift({
      id: uuid(), kind: "faucet", amount: str(LOCAL_POLICY.faucetAmount), fee: "0",
      state: "credited", note: "Beta faucet claim", at: new Date(now).toISOString(),
    });
    this.save();
    return { amount: str(LOCAL_POLICY.faucetAmount) };
  }

  async withdraw(amount: string, dest: string): Promise<Withdrawal> {
    this.requireUser();
    const amt = big(amount);
    if (amt < POLICY.minWithdrawal) err("MIN_WITHDRAWAL", "Minimum withdrawal is 5,000 $SHINY.");
    if (dest.trim().length < 3) err("BAD_DEST", "Give the courier an address.");
    // v1.1: withdrawal fee is f(tier) — 5% Alley → 2% Kingpin
    const fee = applyBps(amt, this.perks().withdrawalFeeBps);
    this.debit(amt, "the withdrawal");
    this.state.treasuryFromPlayer = str(big(this.state.treasuryFromPlayer) + fee);
    const w: Withdrawal = {
      id: uuid(),
      amount: str(amt),
      fee: str(fee),
      net: str(amt - fee),
      destAddress: dest.trim(),
      state: "sent",
      txSig: "BETA-SIMULATED",
      createdAt: new Date().toISOString(),
    };
    this.state.withdrawals.unshift(w);
    this.state.bankHistory.unshift({
      id: w.id, kind: "withdraw", amount: w.amount, fee: w.fee,
      state: "sent", note: `BETA — simulated payout to ${dest.trim().slice(0, 12)}…`, at: w.createdAt,
    });
    this.save();
    return w;
  }

  async getBankHistory(): Promise<BankHistoryRow[]> {
    return [...this.state.bankHistory];
  }

  /* ── store / raffles / market ───────────────────────────────────── */

  async getStoreItems(): Promise<CosmeticItem[]> {
    return STORE_ITEMS.map((i) => ({ ...i }));
  }

  async buyItem(slug: string): Promise<CosmeticItem> {
    const item = STORE_ITEMS.find((i) => i.slug === slug);
    if (!item) err("NO_SUCH_ITEM", "Not on the shelf.");
    if (!item.priceShiny) err("PREMIUM_ONLY", "SOL checkout arrives with mainnet.");
    this.debit(big(item.priceShiny), item.name);
    this.burn(big(item.priceShiny));
    this.state.inventory.push(item.slug);
    this.save();
    return { ...item };
  }

  async equip(itemSlug: string, characterId: string | null): Promise<Character | null> {
    if (characterId === null) {
      for (const c of this.state.characters) {
        if (c.cosmetics.includes(itemSlug)) {
          c.cosmetics = c.cosmetics.filter((s) => s !== itemSlug);
          this.state.inventory.push(itemSlug);
          this.save();
          return { ...c };
        }
      }
      return null;
    }
    const c = this.char(characterId);
    const idx = this.state.inventory.indexOf(itemSlug);
    if (idx === -1) err("NOT_OWNED", "You don't own that. Yet.");
    const item = STORE_ITEMS.find((i) => i.slug === itemSlug);
    if (item) {
      const sameSlot = c.cosmetics.find((s) => STORE_ITEMS.find((i) => i.slug === s)?.slot === item.slot);
      if (sameSlot) {
        c.cosmetics = c.cosmetics.filter((s) => s !== sameSlot);
        this.state.inventory.push(sameSlot);
      }
    }
    this.state.inventory.splice(idx, 1);
    c.cosmetics = [...c.cosmetics, itemSlug];
    this.save();
    return { ...c };
  }

  async getInventory(): Promise<string[]> {
    return [...this.state.inventory];
  }

  async getRaffles(): Promise<Raffle[]> {
    this.advance(Date.now());
    return this.state.raffles.map((r) => this.publicRaffle(r));
  }

  async buyTickets(id: string, count: number): Promise<Raffle> {
    const r = this.state.raffles.find((x) => x.id === id);
    if (!r) err("NO_SUCH_RAFFLE", "That drum isn't spinning.");
    if (r.state !== "open") err("RAFFLE_CLOSED", "Sales are closed.");
    const n = Math.max(1, Math.floor(count));
    const cost = big(r.ticketPrice) * BigInt(n);
    this.debit(cost, "raffle tickets");
    this.burn(cost);
    r.myTickets = (r.myTickets ?? 0) + n;
    // v1.1 pass: 5 XP per ticket, capped at 25/day
    const now = Date.now();
    this.rollDailyCaps(now);
    const room = Math.max(0, PASS.xp.raffleTicketDailyCap - this.state.pass.raffleXpToday);
    const grant = Math.min(room, n * PASS.xp.raffleTicket);
    if (grant > 0) {
      this.state.pass.raffleXpToday += grant;
      this.addXp(grant);
    }
    this.trackChallenge(now, "raffle_tickets", undefined, n);
    this.save();
    return this.publicRaffle(r);
  }

  async getListings(): Promise<Listing[]> {
    const now = Date.now();
    const bots: Listing[] = botListings(now)
      .filter((b) => !this.state.purchasedBotListings.includes(b.id))
      .map((b) => ({
        id: b.id,
        kind: "character",
        sellerHandle: b.seller,
        refId: b.id,
        price: b.price,
        state: "active",
        character: {
          id: b.id, name: b.name, faction: "raccoon", level: b.level, stats: b.stats,
          status: "listed", stationedAt: null, jailedUntil: null, patrolEndsAt: null,
          nftMint: null, inGame: true, lastClaimedAt: null, dna: b.dna, cosmetics: [],
        },
        cosmeticSlug: null,
        createdAt: b.createdAt,
      }));
    const mine = this.state.myListings.filter((l) => l.state === "active");
    return [...mine, ...bots];
  }

  async list(refId: string, price: string): Promise<Listing> {
    const u = this.requireUser();
    const c = this.char(refId);
    if (c.status !== "idle") err("CHARACTER_BUSY", `${c.name} is ${c.status}.`);
    if (big(price) <= 0n) err("BAD_PRICE", "Price it like you mean it.");
    c.status = "listed";
    const l: Listing = {
      id: uuid(),
      kind: "character",
      sellerHandle: u.handle,
      refId,
      price,
      state: "active",
      character: { ...c },
      cosmeticSlug: null,
      createdAt: new Date().toISOString(),
    };
    this.state.myListings.unshift(l);
    this.save();
    return l;
  }

  async buyListing(id: string): Promise<Listing> {
    const mine = this.state.myListings.find((l) => l.id === id);
    if (mine) err("OWN_LISTING", "That's your own merchandise.");
    const bot = botListings(Date.now()).find((b) => b.id === id);
    if (!bot || this.state.purchasedBotListings.includes(id)) err("GONE", "Somebody beat you to it.");
    const price = big(bot.price);
    this.debit(price, "the purchase");
    this.state.purchasedBotListings.push(id);
    const rng = makeRng(bot.dna);
    const c: Character = {
      id: uuid(),
      name: bot.name,
      faction: "raccoon",
      level: bot.level,
      stats: bot.stats,
      status: "idle",
      stationedAt: null,
      jailedUntil: null,
      patrolEndsAt: null,
      nftMint: null,
      inGame: true,
      lastClaimedAt: null,
      dna: bot.dna,
      cosmetics: rng() < 0.2 ? ["hat-beanie"] : [],
    };
    this.state.characters.push(c);
    this.save();
    return {
      id: bot.id, kind: "character", sellerHandle: bot.seller, refId: c.id,
      price: bot.price, state: "sold", character: { ...c }, cosmeticSlug: null,
      createdAt: bot.createdAt,
    };
  }

  async delist(id: string): Promise<Listing> {
    const l = this.state.myListings.find((x) => x.id === id);
    if (!l || l.state !== "active") err("NO_SUCH_LISTING", "Nothing to pull.");
    l.state = "delisted";
    const c = this.state.characters.find((x) => x.id === l.refId);
    if (c && c.status === "listed") c.status = "idle";
    this.save();
    return { ...l };
  }

  /* ── public ─────────────────────────────────────────────────────── */

  async getLeaderboard(board: LeaderboardBoard): Promise<LeaderboardEntry[]> {
    const now = Date.now();
    const entries = botLeaderboard(board, now);
    const u = this.state.user;
    if (!u) return entries;
    let myValue: bigint;
    let detail: string;
    switch (board) {
      case "earners": myValue = big(this.state.stats.totalEarned); detail = "net heist profit"; break;
      case "hounds": myValue = big(this.state.stats.houndEarned); detail = "bounties collected"; break;
      case "heists": myValue = big(this.state.stats.biggestHeist); detail = "single payout"; break;
      case "most_wanted": myValue = big(this.state.stats.totalConfiscated); detail = "total confiscated"; break;
    }
    const hasHound = this.state.characters.some((c) => c.faction === "bloodhound");
    const myFaction: LeaderboardEntry["faction"] = board === "hounds" ? (hasHound ? "bloodhound" : null) : "raccoon";
    const mine: LeaderboardEntry = { rank: 0, handle: u.handle, faction: myFaction, value: str(myValue), detail };
    const merged: LeaderboardEntry[] = [...entries, mine]
      .sort((a, b) => (big(b.value) > big(a.value) ? 1 : big(b.value) < big(a.value) ? -1 : 0))
      .map((e, i) => ({ ...e, rank: i + 1 }));
    return merged;
  }

  async getPublicStats(): Promise<PublicStats> {
    return syntheticPublicStats(
      Date.now(),
      big(this.state.burnedByPlayer),
      big(this.state.treasuryFromPlayer),
    );
  }

  async getProofOfReserves(): Promise<ProofOfReserves> {
    const me = this.state.user ? await this.getMe() : null;
    const liabilities = me ? big(me.balance) + big(me.lockedBalance) : 0n;
    const synthetic = toBaseUnits(48_000_000);
    const reserves = synthetic + (liabilities * 16n) / 10n;
    const totalLiab = synthetic - toBaseUnits(6_500_000) + liabilities;
    return {
      at: new Date().toISOString(),
      onchainReserves: str(reserves),
      hotWallet: str(reserves / 5n),
      multisig: str(reserves - reserves / 5n),
      liabilities: str(totalLiab),
      ratioBps: Number((reserves * 10_000n) / (totalLiab === 0n ? 1n : totalLiab)),
      healthy: true,
    };
  }

  /* ── v1.1: progressive jackpot ──────────────────────────────────── */

  async getJackpot(): Promise<JackpotState> {
    const now = Date.now();
    this.advance(now);
    return this.jackpotPublic(now);
  }

  onJackpotTick(cb: (state: JackpotState) => void): Unsubscribe {
    this.jackpotSubs.add(cb);
    cb(this.jackpotPublic(Date.now()));
    return () => this.jackpotSubs.delete(cb);
  }

  /* ── v1.1: season pass ──────────────────────────────────────────── */

  private passPublic(now: number): PassState {
    const p = this.state.pass;
    const level = Math.min(PASS.levels, Math.floor(p.xp / PASS.xpPerLevel));
    const rewards: PassState["rewards"] = PASS_REWARDS.map((r) => {
      const claimed = p.claimed.includes(r.id);
      const unlocked = level >= r.level && (r.track === "free" || p.premium);
      return {
        id: r.id,
        level: r.level,
        track: r.track,
        kind: r.kind,
        refSlug: r.refSlug,
        amount: r.amount,
        claimed,
        claimable: unlocked && !claimed,
      };
    });
    const challenges: PassState["challenges"] = this.weekChallenges(now).map((c) => {
      const progress = Math.min(c.target, p.challengeProgress[c.id] ?? 0);
      return {
        id: c.id,
        slug: c.slug,
        description: c.description,
        week: c.week,
        target: c.target,
        progress,
        xp: PASS.xp.weeklyChallenge,
        completed: progress >= c.target,
      };
    });
    return {
      season: 1,
      premium: p.premium,
      level,
      xp: p.xp,
      xpIntoLevel: level >= PASS.levels ? PASS.xpPerLevel : p.xp % PASS.xpPerLevel,
      xpPerLevel: PASS.xpPerLevel,
      insuranceVouchers: p.vouchers,
      rewards,
      challenges,
    };
  }

  async getPass(): Promise<PassState> {
    this.requireUser();
    const now = Date.now();
    this.advance(now);
    return this.passPublic(now);
  }

  /** BETA rail: premium is granted free, play-money framing (specs/02). */
  async buyPass(): Promise<PassState> {
    this.requireUser();
    if (!this.state.pass.premium) {
      this.state.pass.premium = true; // idempotent; retroactive claims unlock automatically
      this.save();
    }
    return this.passPublic(Date.now());
  }

  async claimPassReward(rewardId: string): Promise<PassState> {
    this.requireUser();
    const now = Date.now();
    const def = PASS_REWARDS.find((r) => r.id === rewardId);
    if (!def) err("NO_SUCH_REWARD", "That reward isn't on the ladder.");
    const p = this.state.pass;
    if (p.claimed.includes(def.id)) return this.passPublic(now); // idempotent
    const level = Math.min(PASS.levels, Math.floor(p.xp / PASS.xpPerLevel));
    if (level < def.level) err("LEVEL_LOCKED", `Heat level ${def.level} required.`);
    if (def.track === "premium" && !p.premium) err("PREMIUM_LOCKED", "Premium track needs the pass. Flex, not power.");
    p.claimed.push(def.id);
    switch (def.kind) {
      case "cosmetic":
      case "nameplate":
        if (def.refSlug) this.state.inventory.push(def.refSlug);
        break;
      case "insurance_voucher":
        p.vouchers += def.amount ?? 1;
        break;
      case "raffle_fragments":
        this.state.stats.loginFragments += def.amount ?? 1;
        this.grantFragmentTickets();
        break;
    }
    this.save();
    return this.passPublic(now);
  }

  /* ── v1.1: Street Cred beta simulator ───────────────────────────── */

  /** DEMO ONLY — sets the simulated wallet holding ("buy on Jupiter" stand-in). */
  async simulateHolding(amount: string): Promise<MeResponse> {
    this.requireUser();
    if (!/^\d+$/.test(amount)) err("BAD_AMOUNT", "Holding must be a base-unit integer string.");
    this.state.simulatedHolding = amount;
    this.tickCred(Date.now());
    this.save();
    return this.getMe();
  }

  /* ── live ───────────────────────────────────────────────────────── */

  onFeed(cb: (event: FeedEvent) => void): Unsubscribe {
    this.feedSubs.add(cb);
    // replay buffer so the city is alive immediately
    for (const e of this.feedBuffer) cb(e);
    return () => this.feedSubs.delete(cb);
  }

  onUserEvent(cb: (event: UserEvent) => void): Unsubscribe {
    this.userSubs.add(cb);
    return () => this.userSubs.delete(cb);
  }
}

/** Upgrade price for a stat currently at `value` (value 1 → first paid level). */
export function upgradeCostFor(value: number): bigint {
  // shared upgradeCost(currentLevel) counts upgrades already bought; base stat is 1
  return upgradeCost(Math.max(0, value - 1));
}

function playersActiveWithMine(slug: string, now: number, state: SaveState): number {
  const mine = state.missions.filter((m) => m.state === "active" && m.locationSlug === slug).length;
  return playersActiveAt(slug, now) + mine;
}
