"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useGameClientSafe } from "./client/provider";
import type { GameClient } from "./client/types";
import { GameClientError } from "./client/types";
import { useUiStore } from "./uiStore";

/** Query helper that waits for the client to exist (it's created client-side). */
export function useGameQuery<T>(
  key: readonly unknown[],
  fn: (c: GameClient) => Promise<T>,
  opts?: { refetchInterval?: number; enabled?: boolean },
): UseQueryResult<T> {
  const client = useGameClientSafe();
  return useQuery({
    queryKey: [...key],
    queryFn: () => {
      if (!client) throw new Error("client not ready");
      return fn(client);
    },
    enabled: !!client && (opts?.enabled ?? true),
    refetchInterval: opts?.refetchInterval,
    retry: (count, error) => !(error instanceof GameClientError) && count < 2,
  });
}

export function useMe() {
  return useGameQuery(["me"], (c) => c.getMe(), { refetchInterval: 4_000 });
}

export function useLocations() {
  return useGameQuery(["locations"], (c) => c.getLocations(), { refetchInterval: 8_000 });
}

export function useMissions() {
  return useGameQuery(["missions"], (c) => c.getMissions(), { refetchInterval: 2_000 });
}

export function useCharacters() {
  return useGameQuery(["characters"], (c) => c.getCharacters(), { refetchInterval: 4_000 });
}

/** v1.1 — season pass state (Heat level, rewards, challenges, vouchers). */
export function usePass() {
  return useGameQuery(["pass"], (c) => c.getPass(), { refetchInterval: 5_000 });
}

/** v1.1 — public jackpot pool; live ticks piped into the query cache. */
export function useJackpot() {
  const client = useGameClientSafe();
  const qc = useQueryClient();
  const q = useGameQuery(["jackpot"], (c) => c.getJackpot(), { refetchInterval: 10_000 });
  useEffect(() => {
    if (!client) return;
    return client.onJackpotTick((s) => qc.setQueryData(["jackpot"], s));
  }, [client, qc]);
  return q;
}

/** Generic mutation with toast-on-error + invalidations. */
export function useGameMutation<TArgs, TOut>(
  fn: (c: GameClient, args: TArgs) => Promise<TOut>,
  invalidate: readonly string[],
  opts?: { onSuccess?: (out: TOut) => void; successToast?: (out: TOut) => string },
) {
  const client = useGameClientSafe();
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  return useMutation({
    mutationFn: (args: TArgs) => {
      if (!client) return Promise.reject(new Error("client not ready"));
      return fn(client, args);
    },
    onSuccess: (out) => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: [key] });
      if (opts?.successToast) toast(opts.successToast(out), "success");
      opts?.onSuccess?.(out);
    },
    onError: (e) => {
      toast(e instanceof Error ? e.message : "Something went sideways.", "danger");
    },
  });
}

/** Ticking wall-clock, for countdowns / accrual counters. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** True once mounted on the client (guards anything reading localStorage). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
