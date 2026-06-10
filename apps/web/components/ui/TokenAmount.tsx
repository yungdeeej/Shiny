import { formatShiny } from "@trash-wars/shared";
import clsx from "clsx";
import React from "react";
import { ShinyGlyph } from "../art/Logo";

export function TokenAmount({
  amount,
  compact = true,
  className,
  glyphSize = 14,
  muted = false,
}: {
  amount: bigint | string;
  compact?: boolean;
  className?: string;
  glyphSize?: number;
  muted?: boolean;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-1 tabular-nums font-semibold", muted ? "text-muted" : "text-accent", className)}>
      <ShinyGlyph size={glyphSize} />
      {formatShiny(amount, { compact })}
    </span>
  );
}
