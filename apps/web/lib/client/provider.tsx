"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatShiny } from "@trash-wars/shared";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useUiStore } from "../uiStore";
import { HttpGameClient } from "./http";
import { LocalGameClient } from "./local/engine";
import type { GameClient } from "./types";

const GameClientContext = createContext<GameClient | null>(null);

export function createGameClient(): GameClient {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";
  if (demo) return new LocalGameClient();
  return new HttpGameClient(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000");
}

export function useGameClient(): GameClient {
  const client = useContext(GameClientContext);
  if (!client) throw new Error("useGameClient outside GameClientProvider");
  return client;
}

/** Null during SSR/prerender; a real client in the browser. */
export function useGameClientSafe(): GameClient | null {
  return useContext(GameClientContext);
}

function LiveWiring({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = useGameClient();
  const qc = useQueryClient();
  const pushFeed = useUiStore((s) => s.pushFeed);
  const pushResult = useUiStore((s) => s.pushResult);
  const toast = useUiStore((s) => s.toast);

  useEffect(() => {
    const offFeed = client.onFeed((e) => pushFeed(e));
    const offUser = client.onUserEvent((e) => {
      switch (e.type) {
        case "mission_resolved": {
          void qc.invalidateQueries({ queryKey: ["missions"] });
          void qc.invalidateQueries({ queryKey: ["me"] });
          void qc.invalidateQueries({ queryKey: ["characters"] });
          void qc.invalidateQueries({ queryKey: ["pass"] });
          void qc.invalidateQueries({ queryKey: ["jackpot"] });
          void client.getLocations().then((locs) => {
            const loc = locs.find((l) => l.slug === e.mission.locationSlug);
            pushResult({ mission: e.mission, result: e.result, locationName: loc?.name ?? e.mission.locationSlug });
          });
          break;
        }
        case "balance":
          void qc.invalidateQueries({ queryKey: ["me"] });
          break;
        case "jail_released":
          void qc.invalidateQueries({ queryKey: ["characters"] });
          toast(`${e.characterName} walked out of the tank.`, "success");
          break;
        case "patrol_ended":
          void qc.invalidateQueries({ queryKey: ["patrols"] });
          void qc.invalidateQueries({ queryKey: ["characters"] });
          toast(`${e.patrol.characterName} ended the shift — bounty ${formatShiny(e.bounty, { compact: true })} ✦`, "success");
          break;
        case "raffle_drawn":
          void qc.invalidateQueries({ queryKey: ["raffles"] });
          void qc.invalidateQueries({ queryKey: ["characters"] });
          toast(
            e.won ? `You WON the ${e.raffle.title}!` : `${e.raffle.title} drawn — winner: ${e.raffle.winners?.[0] ?? "?"}`,
            e.won ? "success" : "info",
          );
          break;
        case "listing_sold":
          void qc.invalidateQueries({ queryKey: ["listings"] });
          void qc.invalidateQueries({ queryKey: ["characters"] });
          toast(`Sold ${e.listing.character?.name ?? "a recruit"} — ${formatShiny(e.net, { compact: true })} ✦ net`, "success");
          break;
        case "pass_level_up":
          void qc.invalidateQueries({ queryKey: ["pass"] });
          toast(`🔥 Heat level ${e.level} — new pass rewards unlocked.`, "success");
          break;
      }
    });
    return () => {
      offFeed();
      offUser();
    };
  }, [client, qc, pushFeed, pushResult, toast]);

  return <>{children}</>;
}

/** Keeps uiStore.handle in sync with the session. */
function SessionSync(): null {
  const client = useGameClient();
  const setHandle = useUiStore((s) => s.setHandle);
  const { data, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => client.getMe(),
    retry: false,
    refetchInterval: 5_000,
  });
  useEffect(() => {
    if (data) setHandle(data.handle);
    else if (isError) setHandle(null);
  }, [data, isError, setHandle]);
  return null;
}

export function GameClientProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 3_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const [client, setClient] = useState<GameClient | null>(null);
  useEffect(() => {
    const c = createGameClient();
    setClient(c);
    return () => {
      if (c instanceof LocalGameClient) c.destroy();
    };
  }, []);

  return (
    <QueryClientProvider client={qc}>
      {client ? (
        <GameClientContext.Provider value={client}>
          <SessionSync />
          <LiveWiring>{children}</LiveWiring>
        </GameClientContext.Provider>
      ) : (
        children
      )}
    </QueryClientProvider>
  );
}
