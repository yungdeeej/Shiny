"use client";

import type { FeedEvent } from "@trash-wars/shared";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React, { useEffect, useState } from "react";
import { useNow } from "../../lib/hooks";
import { timeAgo } from "../../lib/time";
import { useUiStore } from "../../lib/uiStore";

const TYPE_EMOJI: Record<FeedEvent["type"], string> = {
  jackpot: "💎",
  win: "🦝",
  rekt: "💀",
  death: "⚰️",
  arrest: "🚔",
  confiscation: "👮",
  mint: "✨",
  raffle: "🎟️",
  burn: "🔥",
  patrol: "🐕",
  bribe: "✉️",
};

/** Bottom marquee — vertical-rotating last feed events. */
export function FeedTicker() {
  const feed = useUiStore((s) => s.feed);
  const reduced = useReducedMotion();
  const now = useNow(5_000);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (feed.length === 0) return;
    const t = setInterval(() => setIdx((i) => i + 1), 4_000);
    return () => clearInterval(t);
  }, [feed.length]);

  const recent = feed.slice(-12);
  const ev = recent.length > 0 ? recent[((idx % recent.length) + recent.length) % recent.length] : undefined;

  return (
    <div className="glass flex h-9 items-center gap-2 overflow-hidden border-x-0 border-b-0 px-3 text-xs">
      <span className="noir-label shrink-0 text-accent">City Feed</span>
      <span className="h-4 w-px shrink-0 bg-line" />
      <div className="relative h-full flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {ev ? (
            <motion.div
              key={ev.id + idx}
              className="absolute inset-0 flex items-center gap-2 truncate"
              initial={reduced ? { opacity: 0 } : { y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { y: -16, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <span aria-hidden>{TYPE_EMOJI[ev.type]}</span>
              <span className="truncate text-text">{ev.message}</span>
              <span className="shrink-0 text-muted">{timeAgo(ev.at, now)}</span>
            </motion.div>
          ) : (
            <motion.div key="empty" className="absolute inset-0 flex items-center text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              Nothing but rain out here.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
