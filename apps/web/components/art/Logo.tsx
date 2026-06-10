import React from "react";
import clsx from "clsx";

/** Tiny paw print used in the wordmark. */
export function PawPrint({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <ellipse cx="12" cy="15.5" rx="5.2" ry="4.4" fill="currentColor" />
      <circle cx="5.5" cy="10.5" r="2.2" fill="currentColor" />
      <circle cx="9.6" cy="7" r="2.3" fill="currentColor" />
      <circle cx="14.4" cy="7" r="2.3" fill="currentColor" />
      <circle cx="18.5" cy="10.5" r="2.2" fill="currentColor" />
    </svg>
  );
}

/** "TRASH WARS" wordmark. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx("inline-flex items-baseline gap-1.5 font-display leading-none select-none", className)}>
      <span className="tracking-tight text-text">TRASH</span>
      <span
        className="tracking-tight text-transparent"
        style={{ WebkitTextStroke: "1.5px #FFB627" }}
      >
        WARS
      </span>
      {!compact && <PawPrint className="text-accent self-center translate-y-[1px]" size={13} />}
    </span>
  );
}

/** ✦ in an amber circle — the $SHINY glyph used by TokenAmount. */
export function ShinyGlyph({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="$SHINY">
      <circle cx="12" cy="12" r="11" fill="#FFB627" opacity="0.16" />
      <circle cx="12" cy="12" r="10.2" fill="none" stroke="#FFB627" strokeWidth="1.6" />
      <path
        d="M12 4.6 L13.8 10.2 L19.4 12 L13.8 13.8 L12 19.4 L10.2 13.8 L4.6 12 L10.2 10.2 Z"
        fill="#FFB627"
      />
    </svg>
  );
}
