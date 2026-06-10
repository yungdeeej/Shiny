import type {
  Character,
  CosmeticItem,
  FeedEvent,
  LeaderboardEntry,
  Listing,
  LocationLive,
  MeResponse,
  MintEvent,
  Mission,
  MissionResult,
  MissionStartRequest,
  MissionVerify,
  Patrol,
  ProofOfReserves,
  PublicStats,
  PvpStats,
  Raffle,
  StatKey,
  Withdrawal,
} from "@trash-wars/shared";

export type LeaderboardBoard = "earners" | "hounds" | "heists" | "most_wanted";

export type ResolvedMission = Mission & { result: MissionResult };

export interface MissionsResponse {
  active: Mission[];
  resolved: ResolvedMission[];
}

export interface BankHistoryRow {
  id: string;
  kind: "deposit" | "withdraw" | "faucet";
  amount: string;
  fee: string;
  state: "queued" | "review" | "sent" | "failed" | "denied" | "credited";
  note: string;
  at: string;
}

/** Events about *your* account pushed by the server (or the local engine). */
export type UserEvent =
  | { type: "mission_resolved"; mission: Mission; result: MissionResult }
  | { type: "balance"; balance: string }
  | { type: "jail_released"; characterId: string; characterName: string }
  | { type: "patrol_ended"; patrol: Patrol; bounty: string }
  | { type: "raffle_drawn"; raffle: Raffle; won: boolean }
  | { type: "listing_sold"; listing: Listing; net: string };

export type Unsubscribe = () => void;

export class GameClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GameClientError";
  }
}

/**
 * The full client surface. Two implementations: LocalGameClient (in-browser
 * beta engine) and HttpGameClient (the real API).
 */
export interface GameClient {
  /* auth/session */
  getMe(): Promise<MeResponse>;
  guestLogin(handle: string): Promise<MeResponse>;
  logout(): Promise<void>;

  /* world */
  getLocations(): Promise<LocationLive[]>;

  /* missions */
  startMission(req: MissionStartRequest): Promise<Mission>;
  getMissions(): Promise<MissionsResponse>;
  getMission(id: string): Promise<Mission | ResolvedMission>;
  buyInsurance(id: string): Promise<Mission>;
  bribe(id: string): Promise<Mission>;
  verifyMission(id: string): Promise<MissionVerify>;

  /* characters */
  getCharacters(): Promise<Character[]>;
  station(id: string, slug: string | null): Promise<Character>;
  claimIdle(id: string): Promise<{ amount: string }>;
  bail(id: string): Promise<Character>;
  upgrade(id: string, stat: StatKey): Promise<Character>;
  rename(id: string, name: string): Promise<Character>;
  getMintEvents(): Promise<MintEvent[]>;
  mint(eventId: string): Promise<Character>;

  /* pvp */
  startPatrol(characterId: string, slug: string): Promise<Patrol>;
  getPatrols(): Promise<Patrol[]>;
  getPvpStats(): Promise<PvpStats>;

  /* bank */
  deposit(amount: string): Promise<{ amount: string }>;
  withdraw(amount: string, dest: string): Promise<Withdrawal>;
  getBankHistory(): Promise<BankHistoryRow[]>;

  /* store / raffles / market */
  getStoreItems(): Promise<CosmeticItem[]>;
  buyItem(slug: string): Promise<CosmeticItem>;
  equip(itemSlug: string, characterId: string | null): Promise<Character | null>;
  getRaffles(): Promise<Raffle[]>;
  buyTickets(id: string, count: number): Promise<Raffle>;
  getListings(): Promise<Listing[]>;
  list(refId: string, price: string): Promise<Listing>;
  buyListing(id: string): Promise<Listing>;
  delist(id: string): Promise<Listing>;

  /* public */
  getLeaderboard(board: LeaderboardBoard): Promise<LeaderboardEntry[]>;
  getPublicStats(): Promise<PublicStats>;
  getProofOfReserves(): Promise<ProofOfReserves>;

  /* live */
  onFeed(cb: (event: FeedEvent) => void): Unsubscribe;
  onUserEvent(cb: (event: UserEvent) => void): Unsubscribe;

  /** Owned cosmetics not currently equipped anywhere (local inventory). */
  getInventory(): Promise<string[]>;
}
