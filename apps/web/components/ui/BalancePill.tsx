"use client";

import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { useMe } from "../../lib/hooks";
import { TokenAmount } from "./TokenAmount";
import { Skeleton } from "./Skeleton";

/** Live balance with a +/− delta flash when it changes. */
export function BalancePill() {
  const { data: me } = useMe();
  const prev = useRef<bigint | null>(null);
  const [delta, setDelta] = useState<bigint | null>(null);

  useEffect(() => {
    if (!me) return;
    const bal = BigInt(me.balance);
    if (prev.current !== null && bal !== prev.current) {
      setDelta(bal - prev.current);
      const t = setTimeout(() => setDelta(null), 1_800);
      prev.current = bal;
      return () => clearTimeout(t);
    }
    prev.current = bal;
  }, [me]);

  if (!me) return <Skeleton className="h-8 w-24 rounded-full" />;

  return (
    <span className="relative inline-flex items-center rounded-full border border-accent/40 bg-surface px-3 py-1.5 shadow-glow-amber">
      <TokenAmount amount={me.balance} className="text-sm" />
      <AnimatePresence>
        {delta !== null && (
          <motion.span
            key={String(delta) + Math.random()}
            className={`absolute -bottom-5 right-1 text-xs font-bold tabular-nums ${delta >= 0n ? "text-success" : "text-danger"}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {delta >= 0n ? "+" : ""}
            {(Number(delta) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
