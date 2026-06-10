"use client";

import { makeRng } from "@trash-wars/economy";
import { formatShiny, type CredTier } from "@trash-wars/shared";
import React from "react";
import { TIER_LABEL, TIER_STYLE } from "../../components/game/TierBadge";
import { VaultWidget } from "../../components/game/VaultWidget";
import { ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { weeklyBurns } from "../../lib/client/local/bots";
import { useGameQuery, useJackpot, useNow } from "../../lib/hooks";
import { timeAgo } from "../../lib/time";

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

/** Plausible holder-tier histogram, faked deterministically for the demo. */
function tierDistribution(players: number): Array<{ tier: CredTier; count: number }> {
  const rng = makeRng("tier-distribution");
  const shares: Array<[CredTier, number]> = [
    ["alley", 0.61 + rng() * 0.04],
    ["block", 0.22 + rng() * 0.02],
    ["district", 0.09 + rng() * 0.01],
    ["borough", 0.04],
    ["kingpin", 0.012],
  ];
  return shares.map(([tier, share]) => ({ tier, count: Math.max(1, Math.round(players * share)) }));
}

export default function TransparencyPage() {
  const { data: stats, isLoading, isError, refetch } = useGameQuery(["public-stats"], (c) => c.getPublicStats(), { refetchInterval: 10_000 });
  const { data: jackpot } = useJackpot();
  const now = useNow(1_000);
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

      {/* v1.1 — progressive jackpot pool + hits */}
      {jackpot && (
        <div className="space-y-2">
          <div className="noir-label">The Mint vault — progressive jackpot</div>
          <div className="grid gap-3 md:grid-cols-2">
            <VaultWidget pool={jackpot.pool} winnable={jackpot.winnable} winnableAt={jackpot.winnableAt} now={now} />
            <div className="card space-y-2.5 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Seeded at TGE</span>
                <span className="font-bold tabular-nums">{formatShiny(jackpot.seeded, { compact: true })} ✦</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Feeds from</span>
                <span className="font-bold">5% of every lost stake</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Vault hits</span>
                <span className="font-bold tabular-nums">{jackpot.hits}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Last winner</span>
                {jackpot.lastWinner ? (
                  <span className="text-right">
                    <span className="font-bold text-accent">{jackpot.lastWinner.handle}</span>{" "}
                    <span className="tabular-nums">{formatShiny(jackpot.lastWinner.amount, { compact: true })} ✦</span>
                    <span className="block text-[10px] text-muted">{timeAgo(jackpot.lastWinner.at, now)}</span>
                  </span>
                ) : (
                  <span className="text-muted">nobody yet — the pool never resets below the 10% floor</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* v1.1 — street cred tier distribution (demo: plausible synthetic histogram) */}
      <div className="space-y-2">
        <div className="noir-label">Street Cred — holder tiers</div>
        <div className="card space-y-2 p-4">
          {(() => {
            const dist = tierDistribution(stats.players);
            const max = Math.max(...dist.map((d) => d.count), 1);
            return dist.map((d) => (
              <div key={d.tier} className="flex items-center gap-3 text-xs">
                <span className={`w-16 font-semibold ${TIER_STYLE[d.tier].text}`}>{TIER_LABEL[d.tier]}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent/50 to-accent"
                    style={{ width: `${(d.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-14 text-right tabular-nums text-muted">{d.count.toLocaleString("en-US")}</span>
              </div>
            ));
          })()}
          <p className="pt-1 text-[10px] text-muted/60">Holdings are wallet-held and on-chain — the game never touches them.</p>
        </div>
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
