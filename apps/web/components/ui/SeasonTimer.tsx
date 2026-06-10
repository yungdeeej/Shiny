"use client";

import { SEASON1 } from "@trash-wars/economy";
import React from "react";
import { SEASON_START_MS } from "../../lib/client/local/bots";
import { useNow } from "../../lib/hooks";

export function SeasonTimer() {
  const now = useNow(60_000);
  const end = SEASON_START_MS + SEASON1.days * 86_400_000;
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86_400_000));
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted sm:inline-flex">
      <span className="font-bold text-text">{SEASON1.name}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{daysLeft}d left</span>
    </span>
  );
}
