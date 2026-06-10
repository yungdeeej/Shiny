import clsx from "clsx";
import React from "react";

/** Label + segmented pips up to a cap. */
export function StatBar({
  label,
  value,
  cap = 10,
  color = "bg-accent",
  className,
}: {
  label: string;
  value: number;
  cap?: number;
  color?: string;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <span className="noir-label w-20 shrink-0">{label}</span>
      <div className="flex flex-1 gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              "h-2.5 flex-1 rounded-sm transition-colors",
              i < value ? color : "bg-surface2 border border-line",
            )}
          />
        ))}
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums text-text">
        {value}<span className="text-muted">/{cap}</span>
      </span>
    </div>
  );
}
