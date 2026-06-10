"use client";

import type { MissionOutcome, ProbabilityTable as PTable } from "@trash-wars/shared";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import React from "react";

const OUTCOME_META: Record<MissionOutcome, { label: string; bar: string; text: string }> = {
  win: { label: "Win", bar: "bg-success", text: "text-success" },
  jackpot: { label: "Jackpot", bar: "bg-jackpot", text: "text-jackpot" },
  nothing: { label: "Nothing", bar: "bg-slate-500", text: "text-muted" },
  arrest: { label: "Arrest", bar: "bg-pd", text: "text-pd" },
  confiscation: { label: "Confiscated", bar: "bg-[#FF8A3C]", text: "text-[#FF8A3C]" },
  rekt_items: { label: "Rekt (items)", bar: "bg-danger/80", text: "text-danger" },
  rekt_character: { label: "Rekt (fatal)", bar: "bg-danger", text: "text-danger" },
};

/**
 * Animated probability bars. When `base` differs from `table`, delta arrows
 * show how stats/patrols moved each band.
 */
export function ProbabilityTable({
  table,
  base,
  className,
  highlightOutcome,
}: {
  table: PTable;
  base?: PTable;
  className?: string;
  highlightOutcome?: MissionOutcome;
}) {
  const reduced = useReducedMotion();
  const max = Math.max(...table.map((r) => r.probabilityBps), 1);
  return (
    <div className={clsx("space-y-1.5", className)}>
      {table.map((row) => {
        const meta = OUTCOME_META[row.outcome];
        const baseRow = base?.find((r) => r.outcome === row.outcome);
        const delta = baseRow ? row.probabilityBps - baseRow.probabilityBps : 0;
        const highlighted = highlightOutcome === row.outcome;
        return (
          <div
            key={row.outcome}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-2 py-1",
              highlighted && "bg-surface2 ring-1 ring-accent/60",
            )}
          >
            <span className={clsx("w-24 shrink-0 text-xs font-semibold", meta.text)}>{meta.label}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface2">
              <motion.div
                className={clsx("h-full rounded-full", meta.bar)}
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${(row.probabilityBps / max) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs font-bold tabular-nums text-text">
              {(row.probabilityBps / 100).toFixed(1)}%
            </span>
            <span className="w-12 shrink-0 text-right text-[10px] tabular-nums">
              {delta !== 0 && (
                <span className={delta < 0 ? "text-success" : "text-danger"}>
                  {delta < 0 ? "▼" : "▲"}{Math.abs(delta / 100).toFixed(1)}
                </span>
              )}
            </span>
            <span className="w-12 shrink-0 text-right">
              {row.multiplierBps !== undefined && (
                <span className={clsx("rounded-md px-1.5 py-0.5 text-[10px] font-bold", row.outcome === "jackpot" ? "bg-jackpot/20 text-jackpot" : "bg-success/15 text-success")}>
                  {(row.multiplierBps / 10_000).toFixed(1)}×
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
