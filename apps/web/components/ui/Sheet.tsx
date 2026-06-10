"use client";

import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React, { useEffect } from "react";

/**
 * Sheet — right-side modal panel on desktop, bottom drawer on mobile.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center md:items-stretch md:justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          aria-modal
          role="dialog"
        >
          <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
          <motion.div
            className={clsx(
              "glass relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl shadow-sheet",
              "md:m-3 md:max-h-none md:rounded-2xl",
              wide ? "md:w-[560px]" : "md:w-[460px]",
            )}
            initial={reduced ? { opacity: 0 } : { y: "100%", x: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, x: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="font-display text-lg">{title}</div>
              <button
                onClick={onClose}
                className="rounded-lg border border-line bg-surface2 px-2.5 py-1 text-sm text-muted hover:text-text"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
