"use client";

/**
 * Tiny bridge between the lazily-loaded Solana wallet tree (lib/wallet.tsx,
 * code-split via next/dynamic) and the rest of the app. This module pulls in
 * ZERO wallet libraries so importing it from TopBar/onboarding costs nothing
 * in demo mode.
 */
import { create } from "zustand";

export type WalletFlowPhase = "idle" | "connecting" | "signing" | "verifying" | "error";

interface WalletUiState {
  /** Connect modal visibility (rendered inside the lazy wallet tree). */
  modalOpen: boolean;
  phase: WalletFlowPhase;
  error: string | null;
  /** Invoked once after a successful SIWS login (set by openModal caller). */
  onSuccess: (() => void) | null;
  /** wallet.disconnect(), registered by the wallet tree when it mounts. */
  disconnect: (() => Promise<void>) | null;
  openModal: (onSuccess?: () => void) => void;
  closeModal: () => void;
  setPhase: (phase: WalletFlowPhase, error?: string | null) => void;
  setDisconnect: (fn: (() => Promise<void>) | null) => void;
}

export const useWalletUiStore = create<WalletUiState>((set) => ({
  modalOpen: false,
  phase: "idle",
  error: null,
  onSuccess: null,
  disconnect: null,
  openModal: (onSuccess) => set({ modalOpen: true, phase: "idle", error: null, onSuccess: onSuccess ?? null }),
  closeModal: () => set({ modalOpen: false, phase: "idle", error: null, onSuccess: null }),
  setPhase: (phase, error = null) => set({ phase, error }),
  setDisconnect: (fn) => set({ disconnect: fn }),
}));

/** Best-effort wallet disconnect (no-op when the wallet tree isn't mounted). */
export async function disconnectWallet(): Promise<void> {
  const fn = useWalletUiStore.getState().disconnect;
  if (!fn) return;
  try {
    await fn();
  } catch {
    /* already disconnected / user rejected — session logout is what matters */
  }
}

export function truncateAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
