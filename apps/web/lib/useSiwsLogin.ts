"use client";

/**
 * Sign-In With Solana against the real API:
 *   connect → POST /auth/nonce {address} → wallet.signMessage(message)
 *   → POST /auth/verify {address, signature(bs58)} → session cookie → ['me'].
 *
 * Lives behind the lazy wallet chunk (imports @solana/wallet-adapter-react);
 * only the wallet tree (lib/wallet.tsx) should import this.
 */
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import { useCallback } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const env = json as { error?: { message?: string } } | null;
    throw new Error(env?.error?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export function useSiwsLogin(): () => Promise<void> {
  const { publicKey, signMessage } = useWallet();
  const qc = useQueryClient();

  return useCallback(async () => {
    if (!publicKey) throw new Error("Wallet not connected.");
    if (!signMessage) throw new Error("This wallet can't sign messages — try Phantom or Solflare.");
    const address = publicKey.toBase58();

    const { message } = await post<{ nonce: string; message: string }>("/auth/nonce", { address });
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    await post<{ ok: boolean; userId: string }>("/auth/verify", { address, signature });

    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [publicKey, signMessage, qc]);
}
