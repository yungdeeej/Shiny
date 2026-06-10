"use client";

/**
 * Season Pass dual-track reward rail (specs/02): free track on top, premium
 * underneath, one column per level, horizontal scroll. States: locked /
 * claimable / claimed (+ premium-locked overlay without the pass).
 */
import { PASS, type PassState } from "@trash-wars/shared";
import clsx from "clsx";
import React from "react";
import { STORE_ITEMS } from "../../lib/client/local/content";

type PassReward = PassState["rewards"][number];

const KIND_ICON: Record<PassReward["kind"], string> = {
  cosmetic: "🧢",
  insurance_voucher: "🛡️",
  raffle_fragments: "🎟️",
  nameplate: "🏷️",
};

function rewardLabel(r: PassReward): string {
  switch (r.kind) {
    case "cosmetic":
      return STORE_ITEMS.find((i) => i.slug === r.refSlug)?.name ?? r.refSlug ?? "Cosmetic";
    case "insurance_voucher":
      return `Insurance voucher ×${r.amount ?? 1}`;
    case "raffle_fragments":
      return `Raffle fragments ×${r.amount ?? 1}`;
    case "nameplate":
      return r.refSlug?.includes("gold") ? "Gold Heat plate" : r.refSlug?.includes("silver") ? "Silver Heat plate" : "Bronze Heat plate";
  }
}

function RewardCell({ reward, level, premiumOwned, onClaim, claiming }: {
  reward: PassReward | undefined;
  level: number;
  premiumOwned: boolean;
  onClaim?: (id: string) => void;
  claiming?: boolean;
}) {
  if (!reward) {
    return <div className="h-[74px] rounded-xl border border-dashed border-line/50" aria-hidden />;
  }
  const levelLocked = !reward.claimed && !reward.claimable && level < reward.level;
  const premiumLocked = reward.track === "premium" && !premiumOwned && !reward.claimed;
  return (
    <div
      className={clsx(
        "relative flex h-[74px] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 text-center",
        reward.claimed && "border-success/40 bg-success/5 opacity-70",
        reward.claimable && "border-accent bg-accent/10 shadow-glow-amber",
        !reward.claimed && !reward.claimable && "border-line bg-surface2 opacity-60",
      )}
      title={`${rewardLabel(reward)} — level ${reward.level} (${reward.track})`}
    >
      <span className="text-lg leading-none" aria-hidden>{KIND_ICON[reward.kind]}</span>
      <span className="w-full truncate text-[8px] leading-tight text-muted">{rewardLabel(reward)}</span>
      {reward.claimed ? (
        <span className="text-[9px] font-bold text-success">CLAIMED ✓</span>
      ) : reward.claimable && onClaim ? (
        <button
          onClick={() => onClaim(reward.id)}
          disabled={claiming}
          className="rounded-md bg-accent px-1.5 py-0.5 text-[9px] font-black uppercase text-bg hover:bg-accent2 disabled:opacity-50"
        >
          claim
        </button>
      ) : premiumLocked && level >= reward.level ? (
        <span className="text-[9px] font-bold text-jackpot">PASS 🔒</span>
      ) : (
        <span className="text-[9px] text-muted/70">{levelLocked || level < reward.level ? `LVL ${reward.level} 🔒` : "🔒"}</span>
      )}
    </div>
  );
}

export function PassRewardRail({ pass, onClaim, claiming }: {
  pass: Pick<PassState, "rewards" | "level" | "premium">;
  onClaim?: (id: string) => void;
  claiming?: boolean;
}) {
  const byLevel = new Map<number, { free?: PassReward; premium?: PassReward }>();
  for (const r of pass.rewards) {
    const slot = byLevel.get(r.level) ?? {};
    slot[r.track] = r;
    byLevel.set(r.level, slot);
  }
  const levels = Array.from({ length: PASS.levels }, (_, i) => i + 1);

  return (
    <div className="relative">
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-2" role="list" aria-label="Pass rewards by level">
        {/* track labels */}
        <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-around gap-1.5 bg-bg pr-1.5 pt-5">
          <span className="noir-label !text-[9px]">free</span>
          <span className="noir-label !text-[9px] !text-jackpot">premium</span>
        </div>
        {levels.map((lvl) => {
          const slot = byLevel.get(lvl) ?? {};
          const current = lvl <= pass.level;
          return (
            <div key={lvl} className="w-[64px] shrink-0 space-y-1.5" role="listitem">
              <div
                className={clsx(
                  "text-center text-[10px] font-bold tabular-nums",
                  current ? "text-accent" : "text-muted/60",
                )}
              >
                {lvl}
              </div>
              <RewardCell reward={slot.free} level={pass.level} premiumOwned={pass.premium} onClaim={onClaim} claiming={claiming} />
              <RewardCell reward={slot.premium} level={pass.level} premiumOwned={pass.premium} onClaim={onClaim} claiming={claiming} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
