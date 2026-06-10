"use client";

import { create } from "zustand";
import type { FeedEvent, Mission, MissionResult } from "@trash-wars/shared";

export interface ToastItem {
  id: string;
  tone: "info" | "success" | "danger";
  message: string;
}

export interface PendingResult {
  mission: Mission;
  result: MissionResult;
  locationName: string;
}

interface UiState {
  handle: string | null;
  setHandle: (h: string | null) => void;
  /** queue of resolved missions awaiting the suspense takeover */
  resultQueue: PendingResult[];
  pushResult: (r: PendingResult) => void;
  shiftResult: () => void;
  feed: FeedEvent[];
  pushFeed: (e: FeedEvent) => void;
  soundOn: boolean;
  toggleSound: () => void;
  toasts: ToastItem[];
  toast: (message: string, tone?: ToastItem["tone"]) => void;
  dismissToast: (id: string) => void;
  guided: boolean;
  setGuided: (v: boolean) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  handle: null,
  setHandle: (h) => set({ handle: h }),
  resultQueue: [],
  pushResult: (r) =>
    set((s) =>
      s.resultQueue.some((x) => x.mission.id === r.mission.id)
        ? s
        : { resultQueue: [...s.resultQueue, r] },
    ),
  shiftResult: () => set((s) => ({ resultQueue: s.resultQueue.slice(1) })),
  feed: [],
  pushFeed: (e) =>
    set((s) => {
      if (s.feed.some((x) => x.id === e.id)) return s;
      const next = [...s.feed, e];
      return { feed: next.length > 50 ? next.slice(-50) : next };
    }),
  soundOn: false,
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  toasts: [],
  toast: (message, tone = "info") => {
    const id = `t${++toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }));
    setTimeout(() => get().dismissToast(id), 4_500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  guided: false,
  setGuided: (v) => set({ guided: v }),
}));
