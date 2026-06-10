"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import React from "react";
import { useUiStore } from "../../lib/uiStore";

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-3 top-16 z-[80] flex w-[min(92vw,340px)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={clsx(
              "glass pointer-events-auto rounded-xl px-4 py-3 text-left text-sm shadow-sheet",
              t.tone === "success" && "border-success/40 text-success",
              t.tone === "danger" && "border-danger/40 text-danger",
              t.tone === "info" && "text-text",
            )}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", damping: 24, stiffness: 300 }}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
