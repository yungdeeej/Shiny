"use client";

import { SEASON1_LOCATIONS } from "@trash-wars/economy";
import { POLICY, STAT_EFFECTS } from "@trash-wars/shared";
import clsx from "clsx";
import Link from "next/link";
import React, { useState } from "react";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Button } from "../../components/ui/Button";
import { CountdownPill } from "../../components/ui/CountdownPill";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { HeatBadge } from "../../components/ui/HeatBadge";
import { Skeleton } from "../../components/ui/Skeleton";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { useCharacters, useGameMutation, useGameQuery, useLocations } from "../../lib/hooks";

export default function PrecinctPage() {
  const { data: characters, isLoading, isError, refetch } = useCharacters();
  const { data: locations } = useLocations();
  const { data: patrols } = useGameQuery(["patrols"], (c) => c.getPatrols(), { refetchInterval: 4_000 });
  const { data: pvp } = useGameQuery(["pvp-stats"], (c) => c.getPvpStats(), { refetchInterval: 15_000 });
  const [houndId, setHoundId] = useState<string | null>(null);

  const startPatrol = useGameMutation(
    (c, args: { characterId: string; slug: string }) => c.startPatrol(args.characterId, args.slug),
    ["patrols", "characters", "locations"],
    { successToast: (p) => `${p.characterName} is walking the beat at ${p.locationSlug}.` },
  );

  const hounds = (characters ?? []).filter((c) => c.faction === "bloodhound" && c.status !== "dead");
  const idleHounds = hounds.filter((c) => c.status === "idle");
  const selectedHound = idleHounds.find((c) => c.id === houndId) ?? idleHounds[0];

  if (isError) return <ErrorState message="The precinct desk sergeant ignores you." retry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-pd">Bloodhound HQ</h1>
        <p className="text-sm text-muted">Patrols press the odds against raccoons — and the PD pool pays the force.</p>
      </div>

      {isLoading || !characters ? (
        <Skeleton className="h-48 w-full" />
      ) : hounds.length === 0 ? (
        <div className="card space-y-4 border-pd/40 bg-gradient-to-b from-pd/10 to-surface p-6 text-center">
          <div className="text-5xl" aria-hidden>🐕‍🦺</div>
          <h2 className="font-display text-xl text-pd">Cops eat what raccoons lose.</h2>
          <p className="mx-auto max-w-md text-sm text-muted">
            Every confiscated stake feeds the PD pool. Bloodhounds patrol locations, push arrest odds up, and collect{" "}
            {POLICY.patrolBountyBps / 100}% of the confiscations on their beat. Supply is capped at 10% of living characters.
          </p>
          <Link href="/den">
            <Button variant="pd">Recruit a Bloodhound — 60,000 ✦ burns</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* your hounds */}
          <div className="space-y-2">
            <div className="noir-label">Your hounds</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {hounds.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setHoundId(c.id)}
                  disabled={c.status !== "idle"}
                  className={clsx(
                    "flex w-28 shrink-0 flex-col items-center gap-1 rounded-xl border p-2 text-xs",
                    selectedHound?.id === c.id ? "border-pd bg-pd/10" : "border-line bg-surface2",
                    c.status !== "idle" && "opacity-50",
                  )}
                >
                  <CharacterAvatar dna={c.dna} faction="bloodhound" cosmetics={c.cosmetics} size={56} />
                  <span className="w-full truncate text-center">{c.name}</span>
                  <span className="text-[9px] text-muted">
                    {c.status === "idle"
                      ? `weight ${(1 + c.stats.reputation * STAT_EFFECTS.reputationWeightPerLevel).toFixed(1)}`
                      : c.status.replace("_", " ")}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* patrol assignment */}
          <div className="space-y-2">
            <div className="noir-label">Assign a {POLICY.patrolShiftHours}h shift (≈{POLICY.patrolShiftHours} real minutes)</div>
            <div className="grid gap-2 md:grid-cols-2">
              {(locations ?? []).map((l) => {
                const baseArrest = l.table.find((r) => r.outcome === "arrest")?.probabilityBps ?? 0;
                const effArrest = l.effectiveTable.find((r) => r.outcome === "arrest")?.probabilityBps ?? 0;
                const weight = Math.max(0, (effArrest - baseArrest) / STAT_EFFECTS.patrolArrestBpsPerWeight);
                const pct = Math.min(100, (weight / l.patrolWeightCap) * 100);
                return (
                  <div key={l.slug} className="card flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {l.name} <HeatBadge band={l.heat} />
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface2">
                        <div className="h-full rounded-full bg-pd" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted">
                        patrol weight {weight.toFixed(1)} / cap {l.patrolWeightCap}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="pd"
                      disabled={!selectedHound || startPatrol.isPending}
                      onClick={() => selectedHound && startPatrol.mutate({ characterId: selectedHound.id, slug: l.slug })}
                    >
                      START
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* active shifts */}
          <div className="space-y-2">
            <div className="noir-label">Active shifts</div>
            {!patrols || patrols.length === 0 ? (
              <EmptyState line="No hounds on the street tonight." hint="Bounties only accrue while a shift is live." />
            ) : (
              <div className="card divide-y divide-line">
                {patrols.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span aria-hidden>🐕</span>
                    <span className="flex-1">
                      {p.characterName} on {SEASON1_LOCATIONS.find((l) => l.slug === p.locationSlug)?.name ?? p.locationSlug}
                      <span className="ml-2 text-xs text-muted">weight {p.weight.toFixed(1)}</span>
                    </span>
                    <CountdownPill until={p.shiftEndsAt} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* pd pool stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="noir-label">PD pool</div>
          {pvp ? <TokenAmount amount={pvp.pdPool} className="mt-1 font-display text-xl" /> : <Skeleton className="mt-2 h-6 w-24" />}
        </div>
        <div className="card p-4">
          <div className="noir-label">Trailing APR</div>
          <div className="mt-1 font-display text-xl text-pd">{pvp ? `${(pvp.trailingApr * 100).toFixed(0)}%` : "—"}</div>
        </div>
        <div className="card p-4">
          <div className="noir-label">Force size</div>
          <div className="mt-1 font-display text-xl">
            {pvp ? `${pvp.bloodhoundCount} / ${pvp.livingCharacters}` : "—"}
            <span className="ml-1 text-xs text-muted">(10% cap)</span>
          </div>
        </div>
      </div>

      {/* top hounds */}
      <div className="space-y-2">
        <div className="noir-label">Top hounds this season</div>
        {!pvp ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="card divide-y divide-line">
            {pvp.topHounds.map((h, i) => (
              <div key={h.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-6 font-display text-muted">#{i + 1}</span>
                <span className="flex-1">{h.name}</span>
                <span className="text-xs text-muted">rep {h.reputation}</span>
                <TokenAmount amount={h.earned} className="text-sm" />
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted/60">
        Bounty model: shifts collect {POLICY.patrolBountyBps / 100}% of confiscations on the beat, split by weight.
      </p>
    </div>
  );
}
