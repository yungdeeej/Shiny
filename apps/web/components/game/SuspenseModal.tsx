"use client";

import { makeRng } from "@trash-wars/economy";
import { motion, useReducedMotion } from "framer-motion";
import React, { useEffect, useMemo, useState } from "react";

/**
 * 3.5s security-cam takeover: animated SVG static + scanlines + REC header,
 * then hands off to the ResultTakeover.
 */
export function SuspenseModal({ locationName, onDone, durationMs = 3_500 }: {
  locationName: string;
  onDone: () => void;
  durationMs?: number;
}) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setTimeout(onDone, reduced ? 600 : durationMs);
    return () => clearTimeout(t);
  }, [onDone, durationMs, reduced]);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setFrame((f) => f + 1), 90);
    return () => clearInterval(t);
  }, [reduced]);

  const blocks = useMemo(() => {
    const rng = makeRng(`static:${frame}`);
    return Array.from({ length: 60 }).map((_, i) => ({
      x: rng() * 100,
      y: rng() * 100,
      w: 2 + rng() * 14,
      h: 0.5 + rng() * 2,
      o: 0.04 + rng() * 0.22,
      key: i,
    }));
  }, [frame]);

  return (
    <motion.div
      className="fixed inset-0 z-[75] bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="status"
      aria-label="Resolving mission"
    >
      <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
        <rect width="100" height="100" fill="#06080d" />
        {blocks.map((b) => (
          <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} fill="#9fb0c8" opacity={b.o} />
        ))}
        {/* scanlines */}
        {Array.from({ length: 25 }).map((_, i) => (
          <rect key={`s${i}`} x="0" y={i * 4} width="100" height="0.6" fill="#000" opacity="0.5" />
        ))}
        {/* rolling band */}
        {!reduced && (
          <motion.rect
            x="0" width="100" height="9" fill="#ffffff" opacity="0.05"
            animate={{ y: [-10, 110] }}
            transition={{ duration: 2.1, repeat: Infinity, ease: "linear" }}
          />
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col p-5 font-mono text-xs text-[#9fb0c8]">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            CAM-04 <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger animate-pulse-soft" /> REC
          </span>
          <span>{locationName.toUpperCase()}</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <motion.span
            className="font-display text-xl tracking-[0.3em] text-text/70"
            animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            SIGNAL INTERRUPTED
          </motion.span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-[#5b6b84]">
          <span>SHOREFRONT CITY SURVEILLANCE GRID</span>
          <span>{new Date().toISOString().slice(0, 19).replace("T", " ")}</span>
        </div>
      </div>
    </motion.div>
  );
}
