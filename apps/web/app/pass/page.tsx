"use client";

/**
 * /pass — Season Pass (specs/02). Heat Meter hero, dual-track reward rail,
 * weekly challenges, premium upsell. Iron rule everywhere: flex, not power —
 * SOL never buys stats.
 */
import { PASS } from "@trash-wars/shared";
import clsx from "clsx";
import React from "react";
import { HeatRing } from "../../components/game/HeatMeter";
import { PassRewardRail } from "../../components/game/PassRewardRail";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useGameMutation, usePass } from "../../lib/hooks";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export default function PassPage() {
  const { data: pass, isLoading, isError, refetch } = usePass();

  const buy = useGameMutation((c) => c.buyPass(), ["pass"], {
    successToast: () => "Premium track unlocked. Every earned reward is now claimable — retroactively.",
  });
  const claim = useGameMutation((c, id: string) => c.claimPassReward(id), ["pass", "inventory", "raffles", "me"], {
    successToast: () => "Claimed. Wear it loud.",
  });

  if (isError) return <ErrorState message="The pass office is closed for lunch." retry={() => void refetch()} />;
  if (isLoading || !pass) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-44" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  const claimable = pass.rewards.filter((r) => r.claimable).length;
  const xpBarPct = pass.level >= PASS.levels ? 100 : (pass.xpIntoLevel / pass.xpPerLevel) * 100;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">Season Pass — S1 &ldquo;First Score&rdquo;</h1>
        <p className="text-sm text-muted">Heat builds from playing. Levels unlock flex. Nothing here ever buys power.</p>
      </div>

      {/* Heat Meter hero */}
      <div className="card flex flex-wrap items-center gap-5 p-5">
        <HeatRing level={pass.level} xpIntoLevel={pass.xpIntoLevel} xpPerLevel={pass.xpPerLevel} size={128} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xl">Heat level {pass.level}</span>
            <span
              className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                pass.premium ? "bg-jackpot/20 text-jackpot" : "bg-surface2 text-muted",
              )}
            >
              {pass.premium ? "premium" : "free track"}
            </span>
            {claimable > 0 && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
                {claimable} reward{claimable > 1 ? "s" : ""} waiting
              </span>
            )}
          </div>
          <div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-[#FF8A3C] transition-all"
                style={{ width: `${xpBarPct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>{pass.xp} XP total</span>
              <span>{pass.level >= PASS.levels ? "MAX LEVEL" : `${pass.xpIntoLevel}/${pass.xpPerLevel} into level ${pass.level + 1}`}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted">
            {[
              ["job resolved", PASS.xp.missionResolved],
              ["first job of the day", PASS.xp.dailyFirstMission],
              ["patrol shift", PASS.xp.patrolCompleted],
              ["bail paid", PASS.xp.bailPaid],
              [`raffle ticket (cap ${PASS.xp.raffleTicketDailyCap}/day)`, PASS.xp.raffleTicket],
            ].map(([label, xp]) => (
              <span key={String(label)} className="rounded-full bg-surface2 px-2 py-0.5">
                {label} <span className="font-bold text-accent">+{xp}</span>
              </span>
            ))}
          </div>
          {pass.insuranceVouchers > 0 && (
            <div className="flex w-fit items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-1.5 text-xs">
              🛡️ <span className="font-bold text-success">{pass.insuranceVouchers}</span> insurance voucher{pass.insuranceVouchers > 1 ? "s" : ""} —
              <span className="text-muted">free cover on any rekt-capable job, no burn</span>
            </div>
          )}
        </div>
      </div>

      {/* premium upsell */}
      {!pass.premium && (
        <div className="card flex flex-wrap items-center justify-between gap-4 border-jackpot/50 bg-[radial-gradient(circle_at_85%_20%,rgba(199,146,234,0.12),transparent_60%)] p-5">
          <div className="min-w-0">
            <div className="font-display text-lg text-jackpot">Premium track</div>
            <p className="mt-0.5 max-w-md text-sm text-muted">
              Every level pays out — nameplates at 10/25/50, vouchers, fragments, the loud cosmetics.
              Buy it at level 30, claim all 30 retroactively.
            </p>
            <p className="mt-1.5 text-[11px] font-bold uppercase tracking-widest text-jackpot/90">
              Flex, not power — SOL never buys stats.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-sm text-muted">
              <span className="line-through">0.3 SOL</span>{" "}
              <span className="font-bold text-accent">{DEMO ? "BETA: claim free" : "0.3 SOL"}</span>
            </div>
            <Button onClick={() => buy.mutate(undefined)} loading={buy.isPending}>
              {DEMO ? "Unlock premium (beta, play money)" : "Buy the pass — 0.3 SOL"}
            </Button>
            {DEMO && <span className="text-[9px] text-muted/70">Open beta — the SOL rail arrives with mainnet.</span>}
          </div>
        </div>
      )}

      {/* weekly challenges */}
      <div className="space-y-2">
        <div className="noir-label">This week&apos;s challenges — +{PASS.xp.weeklyChallenge} XP each</div>
        <div className="grid gap-3 md:grid-cols-3">
          {pass.challenges.map((c) => (
            <div key={c.id} className={clsx("card space-y-2 p-4", c.completed && "border-success/40")}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{c.description}</span>
                {c.completed && <span className="shrink-0 text-success" aria-hidden>✓</span>}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
                <div
                  className={clsx("h-full rounded-full", c.completed ? "bg-success" : "bg-accent")}
                  style={{ width: `${Math.min(100, (c.progress / c.target) * 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted">
                <span>{c.progress}/{c.target}</span>
                <span className={clsx(c.completed ? "font-bold text-success" : "")}>
                  {c.completed ? `+${c.xp} XP banked` : `+${c.xp} XP`}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted/60">Challenges rotate weekly (a game-week is ~2.8 real hours in beta).</p>
      </div>

      {/* dual-track reward rail */}
      <div className="space-y-2">
        <div className="noir-label">Reward ladder — free every 5 levels · premium every level</div>
        <PassRewardRail pass={pass} onClaim={(id) => claim.mutate(id)} claiming={claim.isPending} />
        <p className="text-[10px] text-muted/60">
          Iron rule: rewards are cosmetics, vouchers, fragments and nameplates. Never $SHINY. Never stats.
        </p>
      </div>
    </div>
  );
}
