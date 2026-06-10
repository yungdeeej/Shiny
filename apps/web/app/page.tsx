"use client";

import { computePayoutEvBps } from "@trash-wars/economy";
import type { LocationLive } from "@trash-wars/shared";
import { formatShiny } from "@trash-wars/shared";
import clsx from "clsx";
import React, { useEffect, useState } from "react";
import { CityMap } from "../components/art/CityMap";
import { MissionSheet } from "../components/game/MissionSheet";
import { CountdownPill } from "../components/ui/CountdownPill";
import { ErrorState } from "../components/ui/EmptyState";
import { HeatBadge } from "../components/ui/HeatBadge";
import { Skeleton } from "../components/ui/Skeleton";
import { VaultWidget } from "../components/game/VaultWidget";
import { useJackpot, useLocations, useMissions, useNow } from "../lib/hooks";
import { formatGameDuration } from "../lib/time";
import { useUiStore } from "../lib/uiStore";

const MINI_ICON: Record<string, string> = {
  "corner-store": "🏪",
  "pawn-shop": "💰",
  "jewelry-district": "💎",
  "armored-truck": "🚚",
  "first-national": "🏛️",
  "the-mint": "🌆",
  "the-penthouse": "👑",
};

function LocationCard({ loc, onClick }: { loc: LocationLive; onClick: () => void }) {
  const ev = computePayoutEvBps(loc.effectiveTable) / 10_000;
  return (
    <button
      onClick={onClick}
      className="card flex w-full items-center gap-3 p-3 text-left transition-all hover:border-accent/50 hover:shadow-glow-amber"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface2 text-2xl" aria-hidden>
        {MINI_ICON[loc.slug]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-display text-sm">{loc.name}</span>
          <HeatBadge band={loc.heat} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {formatGameDuration(loc.durationHours)} · EV {ev.toFixed(2)}× · {loc.playersActive} active
        </span>
        <span className="mt-0.5 block text-[11px] text-muted/70">
          stake {formatShiny(loc.minStake, { compact: true })}–{formatShiny(loc.maxStake, { compact: true })} ✦
        </span>
      </span>
      <span className="text-muted" aria-hidden>›</span>
    </button>
  );
}

export default function CityPage() {
  const { data: locations, isLoading, isError, refetch } = useLocations();
  const { data: missions } = useMissions();
  const { data: jackpot } = useJackpot();
  const now = useNow(1_000);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const guided = useUiStore((s) => s.guided);

  // guided first mission: force-open the Corner Store sheet
  useEffect(() => {
    if (guided && locations && selectedSlug === null) {
      setSelectedSlug("corner-store");
    }
  }, [guided, locations, selectedSlug]);

  const selected = locations?.find((l) => l.slug === selectedSlug) ?? null;
  const active = missions?.active ?? [];

  if (isError) return <ErrorState message="The city went dark." retry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl">Shorefront City</h1>
        {active.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="noir-label">{active.length} job{active.length > 1 ? "s" : ""} running</span>
            {active.slice(0, 2).map((m) => (
              <CountdownPill key={m.id} until={m.resolvesAt} />
            ))}
          </div>
        )}
      </div>

      {isLoading || !locations ? (
        <div className="space-y-3">
          <Skeleton className="hidden aspect-[3/2] w-full md:block" />
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* mobile: the vault counter rides above the location list */}
          {jackpot && (
            <div className="md:hidden">
              <VaultWidget pool={jackpot.pool} winnable={jackpot.winnable} winnableAt={jackpot.winnableAt} now={now} slim />
            </div>
          )}
          {/* desktop: illustrated map */}
          <div className="hidden md:block">
            <CityMap locations={locations} activeMissions={active} now={now} onSelect={setSelectedSlug} jackpot={jackpot ?? null} />
          </div>
          {/* location cards — block-by-block list on mobile, teaser row on desktop */}
          <div className={clsx("grid gap-3", "md:grid-cols-3")}>
            {locations.map((loc) => (
              <LocationCard key={loc.slug} loc={loc} onClick={() => setSelectedSlug(loc.slug)} />
            ))}
          </div>
        </>
      )}

      <MissionSheet location={selected} open={selected !== null} onClose={() => setSelectedSlug(null)} />
    </div>
  );
}
