"use client";

import { POLICY, SINKS, formatShiny } from "@trash-wars/shared";
import React from "react";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Button } from "../../components/ui/Button";
import { CountdownPill } from "../../components/ui/CountdownPill";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useCharacters, useGameMutation } from "../../lib/hooks";

export default function JailPage() {
  const { data: characters, isLoading, isError, refetch } = useCharacters();
  const bail = useGameMutation((c, id: string) => c.bail(id), ["characters", "me"], {
    successToast: (ch) => `${ch.name} is back on the street.`,
  });

  const jailed = (characters ?? []).filter((c) => c.status === "jailed");
  const bailWhole = formatShiny(SINKS.jailBail);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-pd">Shorefront County Jail</h1>
        <p className="text-sm text-muted">
          Arrests cost {POLICY.jailHours} game hours. Bail is {bailWhole} ✦ — {POLICY.bailSplit.burnBps / 100}% burns,{" "}
          {POLICY.bailSplit.pdBps / 100}% feeds the PD pool.
        </p>
      </div>

      {isError ? (
        <ErrorState message="Visiting hours are over." retry={() => void refetch()} />
      ) : isLoading || !characters ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : jailed.length === 0 ? (
        <EmptyState line="Nobody's in the tank. Keep it that way." hint="Stealth training lowers arrest odds. Just saying." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {jailed.map((c) => (
            <div key={c.id} className="card relative overflow-hidden border-pd/40 p-4">
              {/* bars */}
              <div className="pointer-events-none absolute inset-0 flex justify-around opacity-15" aria-hidden>
                {Array.from({ length: 7 }).map((_, i) => (
                  <span key={i} className="w-1.5 bg-pd" />
                ))}
              </div>
              <div className="relative flex items-center gap-4">
                <CharacterAvatar dna={c.dna} faction={c.faction} cosmetics={c.cosmetics} size={72} />
                <div className="min-w-0 flex-1">
                  <div className="font-display">{c.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    release in {c.jailedUntil && <CountdownPill until={c.jailedUntil} />}
                  </div>
                </div>
                <Button variant="pd" loading={bail.isPending} onClick={() => bail.mutate(c.id)}>
                  BAIL — {bailWhole} ✦
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
