"use client";

import clsx from "clsx";
import React from "react";
import { useNow } from "../../lib/hooks";
import { formatCountdown } from "../../lib/time";

/** Live mm:ss countdown to an ISO deadline; pulses under 10s. */
export function CountdownPill({ until, className, prefix }: { until: string; className?: string; prefix?: string }) {
  const now = useNow(500);
  const remaining = Date.parse(until) - now;
  const urgent = remaining > 0 && remaining < 10_000;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 px-2.5 py-1 text-xs font-bold tabular-nums",
        urgent ? "animate-pulse-soft text-accent border-accent/50" : "text-text",
        remaining <= 0 && "text-success border-success/40",
        className,
      )}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="13" r="8.5" stroke="currentColor" strokeWidth="2.4" />
        <path d="M12 9v4.5l3 2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M9 3.5h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {prefix}
      {remaining <= 0 ? "done" : formatCountdown(remaining)}
    </span>
  );
}
