"use client";

/**
 * Season Pass "Heat" widgets (specs/02): the hero level ring used on /pass and
 * the compact TopBar chip linking to it.
 */
import { PASS } from "@trash-wars/shared";
import clsx from "clsx";
import Link from "next/link";
import React from "react";
import { usePass } from "../../lib/hooks";

export function HeatRing({ level, xpIntoLevel, xpPerLevel, size = 120, className }: {
  level: number;
  xpIntoLevel: number;
  xpPerLevel: number;
  size?: number;
  className?: string;
}) {
  const frac = level >= PASS.levels ? 1 : Math.min(1, xpIntoLevel / Math.max(1, xpPerLevel));
  const r = 0.42 * size;
  const C = 2 * Math.PI * r;
  return (
    <div className={clsx("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F2735" strokeWidth={size * 0.075} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#heat-grad)"
          strokeWidth={size * 0.075}
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
        />
        <defs>
          <linearGradient id="heat-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFB627" />
            <stop offset="100%" stopColor="#FF4D5E" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="noir-label !text-[9px]">heat</span>
        <span className="font-display leading-none text-text" style={{ fontSize: size * 0.3 }}>
          {level}
        </span>
        <span className="text-[9px] text-muted">
          {level >= PASS.levels ? "MAX" : `${xpIntoLevel}/${xpPerLevel}`}
        </span>
      </div>
    </div>
  );
}

/** Compact TopBar chip — level + ring, links to /pass. */
export function HeatChip() {
  const { data: pass } = usePass();
  if (!pass) return null;
  const frac = pass.level >= PASS.levels ? 1 : Math.min(1, pass.xpIntoLevel / Math.max(1, pass.xpPerLevel));
  const r = 9;
  const C = 2 * Math.PI * r;
  const claimable = pass.rewards.filter((x) => x.claimable).length;
  return (
    <Link
      href="/pass"
      aria-label={`Season pass: Heat level ${pass.level}`}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-1 text-[11px] font-bold hover:border-danger/50"
      title="Season Pass — Heat"
    >
      <span className="relative inline-flex h-6 w-6 items-center justify-center">
        <svg width="24" height="24" className="-rotate-90">
          <circle cx="12" cy="12" r={r} fill="none" stroke="#1F2735" strokeWidth="2.5" />
          <circle
            cx="12" cy="12" r={r} fill="none" stroke="#FF8A3C" strokeWidth="2.5"
            strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`}
          />
        </svg>
        <span className="absolute text-[9px] leading-none text-text">{pass.level}</span>
      </span>
      <span className="hidden text-[#FF8A3C] sm:inline">HEAT</span>
      {claimable > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-bg">
          {claimable}
        </span>
      )}
    </Link>
  );
}
