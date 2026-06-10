/**
 * HttpGameClient — thin fetch wrapper over the real API (docs 04–09).
 * The backend matches this surface; key responses are zod-parsed, the rest are
 * trusted (the contract lives in @trash-wars/shared).
 */
import {
  character,
  feedEvent,
  jackpotState,
  locationLive,
  meResponse,
  mission,
  missionVerify,
  passState,
  withdrawal,
  type Character,
  type CosmeticItem,
  type FeedEvent,
  type JackpotState,
  type LeaderboardEntry,
  type Listing,
  type LocationLive,
  type MeResponse,
  type MintEvent,
  type Mission,
  type MissionStartRequest,
  type MissionVerify,
  type PassState,
  type Patrol,
  type ProofOfReserves,
  type PublicStats,
  type PvpStats,
  type Raffle,
  type StatKey,
  type Withdrawal,
} from "@trash-wars/shared";
import { z } from "zod";
import {
  GameClientError,
  type BankHistoryRow,
  type GameClient,
  type LeaderboardBoard,
  type MissionsResponse,
  type ResolvedMission,
  type Unsubscribe,
  type UserEvent,
} from "./types";

export class HttpGameClient implements GameClient {
  private readonly base: string;
  private ws: WebSocket | null = null;
  private feedSubs = new Set<(e: FeedEvent) => void>();
  private userSubs = new Set<(e: UserEvent) => void>();
  private jackpotSubs = new Set<(s: JackpotState) => void>();
  private jackpotPoll: ReturnType<typeof setInterval> | null = null;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  private async req<T>(path: string, init?: RequestInit, schema?: { parse: (data: unknown) => T }): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      credentials: "include",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
    const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const env = body as { error?: { code?: string; message?: string } } | null;
      throw new GameClientError(
        env?.error?.code ?? `HTTP_${res.status}`,
        env?.error?.message ?? `Request failed (${res.status})`,
      );
    }
    return schema ? schema.parse(body) : (body as T);
  }

  private ensureSocket(): void {
    if (this.ws || typeof window === "undefined") return;
    const url = `${this.base.replace(/^http/, "ws")}/ws`;
    const ws = new WebSocket(url);
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as { channel?: string; type?: string; event?: unknown };
        if (data.channel === "feed") {
          const parsed = feedEvent.safeParse(data.event);
          if (parsed.success) for (const cb of this.feedSubs) cb(parsed.data);
        } else if (data.channel === "user") {
          for (const cb of this.userSubs) cb(data.event as UserEvent);
        } else if (data.channel === "jackpot" || data.type === "jackpot_tick") {
          // throttled ≥10s server-side (specs/03)
          const parsed = jackpotState.safeParse(data.event);
          if (parsed.success) for (const cb of this.jackpotSubs) cb(parsed.data);
        }
      } catch {
        /* drop malformed frames */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.feedSubs.size + this.userSubs.size + this.jackpotSubs.size > 0) {
        setTimeout(() => this.ensureSocket(), 3_000);
      }
    };
    this.ws = ws;
  }

  /* auth */
  getMe(): Promise<MeResponse> {
    return this.req("/me", undefined, meResponse);
  }
  guestLogin(handle: string): Promise<MeResponse> {
    return this.req("/auth/guest", { method: "POST", body: JSON.stringify({ handle }) }, meResponse);
  }
  async logout(): Promise<void> {
    await this.req("/auth/logout", { method: "POST" });
  }

  /* world */
  getLocations(): Promise<LocationLive[]> {
    return this.req("/game/locations", undefined, z.array(locationLive));
  }

  /* missions */
  startMission(reqBody: MissionStartRequest): Promise<Mission> {
    return this.req("/game/missions", { method: "POST", body: JSON.stringify(reqBody) }, mission);
  }
  getMissions(): Promise<MissionsResponse> {
    return this.req("/game/missions");
  }
  getMission(id: string): Promise<Mission | ResolvedMission> {
    return this.req(`/game/missions/${id}`);
  }
  buyInsurance(id: string, opts?: { useVoucher?: boolean }): Promise<Mission> {
    return this.req(
      `/game/missions/${id}/insurance`,
      { method: "POST", body: JSON.stringify({ useVoucher: opts?.useVoucher ?? false }) },
      mission,
    );
  }
  bribe(id: string): Promise<Mission> {
    return this.req(`/game/missions/${id}/bribe`, { method: "POST" }, mission);
  }
  verifyMission(id: string): Promise<MissionVerify> {
    return this.req(`/game/missions/${id}/verify`, undefined, missionVerify);
  }

  /* characters */
  getCharacters(): Promise<Character[]> {
    return this.req("/game/characters", undefined, z.array(character));
  }
  station(id: string, slug: string | null): Promise<Character> {
    return this.req(`/game/characters/${id}/station`, { method: "POST", body: JSON.stringify({ slug }) }, character);
  }
  claimIdle(id: string): Promise<{ amount: string }> {
    return this.req(`/game/characters/${id}/claim`, { method: "POST" });
  }
  bail(id: string): Promise<Character> {
    return this.req(`/game/characters/${id}/bail`, { method: "POST" }, character);
  }
  upgrade(id: string, stat: StatKey): Promise<Character> {
    return this.req(`/game/characters/${id}/upgrade`, { method: "POST", body: JSON.stringify({ stat }) }, character);
  }
  rename(id: string, name: string): Promise<Character> {
    return this.req(`/game/characters/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) }, character);
  }
  getMintEvents(): Promise<MintEvent[]> {
    return this.req("/game/mints");
  }
  mint(eventId: string): Promise<Character> {
    return this.req(`/game/mints/${eventId}/mint`, { method: "POST" }, character);
  }

  /* pvp */
  startPatrol(characterId: string, slug: string): Promise<Patrol> {
    return this.req("/pvp/patrols", { method: "POST", body: JSON.stringify({ characterId, locationSlug: slug }) });
  }
  getPatrols(): Promise<Patrol[]> {
    return this.req("/pvp/patrols");
  }
  getPvpStats(): Promise<PvpStats> {
    return this.req("/pvp/stats");
  }

  /* bank */
  deposit(amount: string): Promise<{ amount: string }> {
    return this.req("/bank/deposit", { method: "POST", body: JSON.stringify({ amount }) });
  }
  withdraw(amount: string, dest: string): Promise<Withdrawal> {
    return this.req(
      "/bank/withdraw",
      { method: "POST", body: JSON.stringify({ amount, destAddress: dest }) },
      withdrawal,
    );
  }
  getBankHistory(): Promise<BankHistoryRow[]> {
    return this.req("/bank/history");
  }

  /* store / raffles / market */
  getStoreItems(): Promise<CosmeticItem[]> {
    return this.req("/store/items");
  }
  buyItem(slug: string): Promise<CosmeticItem> {
    return this.req(`/store/items/${slug}/buy`, { method: "POST" });
  }
  equip(itemSlug: string, characterId: string | null): Promise<Character | null> {
    return this.req("/store/equip", { method: "POST", body: JSON.stringify({ itemSlug, characterId }) });
  }
  getInventory(): Promise<string[]> {
    return this.req("/store/inventory");
  }
  getRaffles(): Promise<Raffle[]> {
    return this.req("/raffles");
  }
  buyTickets(id: string, count: number): Promise<Raffle> {
    return this.req(`/raffles/${id}/tickets`, { method: "POST", body: JSON.stringify({ count }) });
  }
  getListings(): Promise<Listing[]> {
    return this.req("/market/listings");
  }
  list(refId: string, price: string): Promise<Listing> {
    return this.req("/market/listings", { method: "POST", body: JSON.stringify({ refId, price }) });
  }
  buyListing(id: string): Promise<Listing> {
    return this.req(`/market/listings/${id}/buy`, { method: "POST" });
  }
  delist(id: string): Promise<Listing> {
    return this.req(`/market/listings/${id}`, { method: "DELETE" });
  }

  /* public */
  getLeaderboard(board: LeaderboardBoard): Promise<LeaderboardEntry[]> {
    return this.req(`/public/leaderboard/${board}`);
  }
  getPublicStats(): Promise<PublicStats> {
    return this.req("/public/stats");
  }
  getProofOfReserves(): Promise<ProofOfReserves> {
    return this.req("/public/proof-of-reserves");
  }

  /* v1.1 — progressive jackpot */
  getJackpot(): Promise<JackpotState> {
    // unauthenticated + cached 10s server-side
    return this.req("/public/jackpot", undefined, jackpotState);
  }
  onJackpotTick(cb: (state: JackpotState) => void): Unsubscribe {
    this.jackpotSubs.add(cb);
    this.ensureSocket();
    // polling fallback every 30s while the socket is down/absent
    if (!this.jackpotPoll && typeof window !== "undefined") {
      this.jackpotPoll = setInterval(() => {
        if (this.jackpotSubs.size === 0) return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        void this.getJackpot()
          .then((s) => {
            for (const sub of this.jackpotSubs) sub(s);
          })
          .catch(() => undefined);
      }, 30_000);
    }
    return () => {
      this.jackpotSubs.delete(cb);
      if (this.jackpotSubs.size === 0 && this.jackpotPoll) {
        clearInterval(this.jackpotPoll);
        this.jackpotPoll = null;
      }
    };
  }

  /* v1.1 — season pass */
  getPass(): Promise<PassState> {
    return this.req("/pass", undefined, passState);
  }
  buyPass(): Promise<PassState> {
    return this.req("/pass/buy", { method: "POST" }, passState);
  }
  claimPassReward(rewardId: string): Promise<PassState> {
    return this.req("/pass/claim", { method: "POST", body: JSON.stringify({ rewardId }) }, passState);
  }

  /* live */
  onFeed(cb: (event: FeedEvent) => void): Unsubscribe {
    this.feedSubs.add(cb);
    this.ensureSocket();
    return () => this.feedSubs.delete(cb);
  }
  onUserEvent(cb: (event: UserEvent) => void): Unsubscribe {
    this.userSubs.add(cb);
    this.ensureSocket();
    return () => this.userSubs.delete(cb);
  }
}
