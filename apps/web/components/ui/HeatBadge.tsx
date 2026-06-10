import type { HeatBand } from "@trash-wars/shared";
import clsx from "clsx";
import React from "react";

const CONFIG: Record<HeatBand, { label: string; cls: string; dot: string }> = {
  none: { label: "COLD", cls: "text-muted border-line", dot: "bg-muted" },
  low: { label: "LOW HEAT", cls: "text-success border-success/40", dot: "bg-success" },
  med: { label: "MED HEAT", cls: "text-accent border-accent/40 shadow-glow-amber", dot: "bg-accent" },
  high: { label: "HIGH HEAT", cls: "text-[#FF8A3C] border-[#FF8A3C]/50 shadow-glow-amber", dot: "bg-[#FF8A3C]" },
  blazing: { label: "BLAZING", cls: "text-danger border-danger/50 shadow-glow-danger", dot: "bg-danger" },
};

export function HeatBadge({ band, className }: { band: HeatBand; className?: string }) {
  const c = CONFIG[band];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border bg-surface/80 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em]",
        c.cls,
        className,
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", c.dot, band !== "none" && "animate-pulse-soft")} />
      {c.label}
    </span>
  );
}
