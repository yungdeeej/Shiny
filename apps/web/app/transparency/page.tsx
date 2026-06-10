"use client";

import { formatShiny } from "@trash-wars/shared";
import React from "react";
import { ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { weeklyBurns } from "../../lib/client/local/bots";
import { useGameQuery, useNow } from "../../lib/hooks";

/** SVG supply donut: circulating vs burned (of an illustrative float). */
function SupplyDonut({ circulating, burned }: { circulating: bigint; burned: bigint }) {
  const total = circulating + burned;
  const burnFrac = total > 0n ? Number((burned * 1000n) / total) / 1000 : 0;
  const C = 2 * Math.PI * 54;
  return (
    <svg viewBox="0 0 140 140" className="mx-auto w-44">
      <circle cx="70" cy="70" r="54" fill="none" stroke="#1F2735" strokeWidth="16" />
      <circle
        cx="70" cy="70" r="54" fill="none" stroke="#FFB627" strokeWidth="16"
        strokeDasharray={`${(1 - burnFrac) * C} ${C}`} strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <circle
        cx="70" cy="70" r="54" fill="none" stroke="#FF4D5E" strokeWidth="16"
        strokeDasharray={`${burnFrac * C} ${C}`} strokeDashoffset={-(1 - burnFrac) * C} strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="64" textAnchor="middle" fontSize="11" fill="#8A94A6" fontFamily="Inter, sans-serif">in the wild</text>
      <text x="70" y="82" textAnchor="middle" fontSize="14" fontWeight="700" fill="#E8ECF4" fontFamily="Inter, sans-serif">
        {formatShiny(circulating, { compact: true })}
      </text>
    </svg>
  );
}

export default function TransparencyPage() {
  const { data: stats, isLoading, isError, refetch } = useGameQuery(["public-stats"], (c) => c.getPublicStats(), { refetchInterval: 10_000 });
  const now = useNow(60_000);
  const burns = weeklyBurns(now);

  if (isError) return <ErrorState message="The auditors are asleep." retry={() => void refetch()} />;
  if (isLoading || !stats) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-52" /><Skeleton className="h-52" /><Skeleton className="h-52" />
        </div>
      </div>
    );
  }

  const emissionPct = Math.min(100, Number((BigInt(stats.emissionsSpent) * 100n) / BigInt(stats.emissionsBudget)));
  const seasonPct = (stats.seasonDay / stats.seasonLengthDays) * 100;
  const maxBurn = Math.max(...burns.map((b) => Number(BigInt(b.burned) / 1_000_000n)), 1);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">Open Books</h1>
        <p className="text-sm text-muted">Supply, burns, emissions and the rake — updated live. Day {stats.seasonDay} of {stats.seasonLengthDays}.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card p-4">
          <div className="noir-label mb-2">Supply</div>
          <SupplyDonut circulating={BigInt(stats.circulating)} burned={BigInt(stats.burnedTotal)} />
        </div>
        <div className="card flex flex-col items-center justify-center gap-2 p-4">
          <div className="noir-label">Burned forever</div>
          <span className="text-4xl" aria-hidden>🔥</span>
          <div className="font-display text-3xl text-danger">{formatShiny(stats.burnedTotal, { compact: true })}</div>
          <div className="text-xs text-muted">+{formatShiny(stats.burnedThisWeek, { compact: true })} this week</div>
        </div>
        <div className="card space-y-4 p-4">
          <div>
            <div className="noir-label mb-1.5">Emissions vs schedule</div>
            <svg viewBox="0 0 200 26" className="w-full">
              <rect x="0" y="8" width="200" height="10" rx="5" fill="#1F2735" />
              <rect x="0" y="8" width={seasonPct * 2} height="10" rx="5" fill="#2a3447" />
              <rect x="0" y="8" width={emissionPct * 2} height="10" rx="5" fill="#FFB627" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span className="text-accent">spent {emissionPct}%</span>
              <span>season {seasonPct.toFixed(0)}% gone</span>
            </div>
            <p className="mt-1 text-[10px] text-success">{emissionPct <= seasonPct ? "Under schedule — sustainable." : "Running hot vs schedule."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-surface2 p-2.5">
              <div className="noir-label">PD APR</div>
              <div className="font-display text-lg text-pd">{(stats.pdApr * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded-xl bg-surface2 p-2.5">
              <div className="noir-label">Rake</div>
              <div className="font-display text-lg">{formatShiny(stats.treasuryRake, { compact: true })}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Players", value: stats.players.toLocaleString("en-US") },
          { label: "Missions today", value: stats.missionsToday.toLocaleString("en-US") },
          { label: "Biggest heist this week", value: `${formatShiny(stats.biggestHeistThisWeek, { compact: true })} ✦` },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <div className="noir-label">{s.label}</div>
            <div className="mt-1 font-display text-xl">{s.value}</div>
          </div>
        ))}
      </div>

      {/* weekly burn history */}
      <div className="space-y-2">
        <div className="noir-label">Weekly burn history</div>
        <div className="card space-y-2 p-4">
          {burns.map((b) => {
            const v = Number(BigInt(b.burned) / 1_000_000n);
            return (
              <div key={b.week} className="flex items-center gap-3 text-xs">
                <span className="w-12 text-muted">wk {b.week}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-gradient-to-r from-danger/60 to-danger" style={{ width: `${(v / maxBurn) * 100}%` }} />
                </div>
                <span className="w-16 text-right tabular-nums">{formatShiny(b.burned, { compact: true })}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
