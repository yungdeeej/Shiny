/**
 * Typed in-process event bus feeding the websocket module.
 * 'feed' — city-wide anonymized events; 'user:{id}' — private events (mission results…).
 */
import { EventEmitter } from "node:events";
import type { FeedEvent } from "@trash-wars/shared";

export interface UserEvent {
  type:
    | "mission_resolved"
    | "patrol_ended"
    | "withdrawal_update"
    | "raffle_won"
    | "pd_distribution"
    /* v1.1 */
    | "bail_paid"
    | "raffle_tickets_bought"
    | "jackpot_won"
    | "pass_level_up";
  [key: string]: unknown;
}

export class GameBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emitFeed(event: FeedEvent): void {
    this.emitter.emit("feed", event);
  }

  onFeed(fn: (event: FeedEvent) => void): () => void {
    this.emitter.on("feed", fn);
    return () => this.emitter.off("feed", fn);
  }

  emitUser(userId: string, event: UserEvent): void {
    this.emitter.emit(`user:${userId}`, event);
    // Wildcard channel: the Season Pass XP listener fans out from here (v1.1).
    this.emitter.emit("user:*", userId, event);
  }

  /** Subscribe to EVERY user event (Season Pass XP fan-out). */
  onAnyUser(fn: (userId: string, event: UserEvent) => void): () => void {
    this.emitter.on("user:*", fn);
    return () => this.emitter.off("user:*", fn);
  }

  /** v1.1 (specs/03): the jackpot pool changed — drives the throttled ws tick. */
  emitJackpot(): void {
    this.emitter.emit("jackpot");
  }

  onJackpot(fn: () => void): () => void {
    this.emitter.on("jackpot", fn);
    return () => this.emitter.off("jackpot", fn);
  }

  onUser(userId: string, fn: (event: UserEvent) => void): () => void {
    this.emitter.on(`user:${userId}`, fn);
    return () => this.emitter.off(`user:${userId}`, fn);
  }

  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}
