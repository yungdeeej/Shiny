"use client";

/**
 * VaultWidget — the progressive jackpot counter (specs/03).
 * Odometer-style rolling digits (no deps), amber-on-dark, vault-door motif.
 * Variants: `boarded` (planks + "OPENING SOON", greed through the cracks) and
 * `live` (gold glow, WINNABLE NOW pulse). `slim` renders the one-line banner
 * used on the logged-out onboarding title beat.
 */
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import React from "react";
import { formatCountdown } from "../../lib/time";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function RollingDigit({ d }: { d: number }) {
  const reduced = useReducedMotion();
  if (reduced) {
    return <span className="tabular-nums">{d}</span>;
  }
  return (
    <span
      className="relative inline-block h-[1.05em] overflow-hidden align-baseline"
      style={{ width: "0.62em" }}
      aria-hidden
    >
      <motion.span
        className="absolute left-0 top-0 flex flex-col"
        animate={{ y: `-${d * 1.05}em` }}
        transition={{ type: "spring", stiffness: 120, damping: 22, mass: 0.6 }}
      >
        {DIGITS.map((n) => (
          <span key={n} className="block h-[1.05em] text-center leading-[1.05em] tabular-nums">
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/** Odometer over a whole-SHINY integer, with static comma separators. */
export function Odometer({ value, className }: { value: bigint; className?: string }) {
  const text = value.toLocaleString("en-US");
  return (
    <span className={clsx("inline-flex items-baseline font-display", className)} aria-label={`${text} SHINY`}>
      {text.split("").map((ch, i) =>
        ch >= "0" && ch <= "9" ? (
          <RollingDigit key={`${text.length}-${i}`} d={Number(ch)} />
        ) : (
          <span key={`${text.length}-${i}`} className="px-[0.02em]">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

function VaultDoor({ size = 44, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <circle cx="24" cy="24" r="21" fill="#1b1606" stroke="#FFB627" strokeWidth="2.5" />
      <circle cx="24" cy="24" r="14" fill="none" stroke="#FFD56B" strokeWidth="1.8" opacity="0.8" />
      {/* spokes */}
      <g stroke="#FFD56B" strokeWidth="2" strokeLinecap="round" opacity={open ? 0.4 : 0.9}>
        <line x1="24" y1="13" x2="24" y2="35" />
        <line x1="13" y1="24" x2="35" y2="24" />
        <line x1="16.5" y1="16.5" x2="31.5" y2="31.5" />
        <line x1="31.5" y1="16.5" x2="16.5" y2="31.5" />
      </g>
      <circle cx="24" cy="24" r="3.4" fill="#FFB627" />
      {/* bolts */}
      {[45, 135, 225, 315].map((deg) => (
        <circle
          key={deg}
          cx={24 + 18 * Math.cos((deg * Math.PI) / 180)}
          cy={24 + 18 * Math.sin((deg * Math.PI) / 180)}
          r="1.6"
          fill="#FFB627"
          opacity="0.7"
        />
      ))}
      {open && <circle cx="24" cy="24" r="21" fill="#FFD56B" opacity="0.12" />}
    </svg>
  );
}

function Planks() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
      {[{ r: -8, t: "12%" }, { r: 6, t: "46%" }, { r: -4, t: "76%" }].map((p, i) => (
        <div
          key={i}
          className="absolute -inset-x-4 h-4 border-y border-[#0a0d13] bg-[#3a3220] opacity-80 shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
          style={{ top: p.t, transform: `rotate(${p.r}deg)` }}
        >
          <div className="absolute left-[12%] top-1 h-1.5 w-1.5 rounded-full bg-[#0a0d13]" />
          <div className="absolute right-[18%] top-1 h-1.5 w-1.5 rounded-full bg-[#0a0d13]" />
        </div>
      ))}
    </div>
  );
}

export interface VaultWidgetProps {
  pool: string;
  winnable: boolean;
  /** ISO — for the "vault opens soon" countdown (beta time). */
  winnableAt?: string | null;
  now?: number;
  /** Slim one-line banner (onboarding / landing). */
  slim?: boolean;
  className?: string;
}

export function VaultWidget({ pool, winnable, winnableAt, now, slim, className }: VaultWidgetProps) {
  const whole = BigInt(pool) / 1_000_000n;
  const variant: "boarded" | "live" = winnable ? "live" : "boarded";
  const countdownMs =
    !winnable && winnableAt && now ? Math.max(0, Date.parse(winnableAt) - now) : null;

  if (slim) {
    return (
      <div
        className={clsx(
          "relative flex items-center justify-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2",
          variant === "live" ? "border-accent/60 bg-accent/10 shadow-glow-amber" : "border-accent/30 bg-[#13100a]",
          className,
        )}
      >
        <VaultDoor size={22} open={variant === "live"} />
        <span className="noir-label !text-accent/80">The Mint vault</span>
        <Odometer value={whole} className="text-lg text-accent2" />
        <span className="text-accent" aria-hidden>✦</span>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          {variant === "live" ? (
            <span className="animate-pulse-soft font-bold text-accent">winnable now</span>
          ) : (
            "and climbing"
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-2xl border p-3.5",
        variant === "live"
          ? "border-accent/70 bg-[#171206] shadow-glow-amber"
          : "border-[#3a3220] bg-[#11100b]",
        className,
      )}
    >
      {/* amber wash behind the number — greed through the cracks */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 60%, rgba(255,182,39,0.16), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        <VaultDoor size={44} open={variant === "live"} />
        <div className="min-w-0">
          <div className="noir-label !text-accent/80">
            {variant === "live" ? "The Mint — vault open" : "The Mint — opening soon"}
          </div>
          <div className="flex items-baseline gap-1.5">
            <Odometer value={whole} className="text-2xl text-accent2 drop-shadow-[0_0_10px_rgba(255,182,39,0.45)]" />
            <span className="text-sm text-accent" aria-hidden>✦</span>
          </div>
          <div className="text-[10px] text-muted">
            {variant === "live" ? (
              <span className="animate-pulse-soft font-bold uppercase tracking-widest text-accent">
                Winnable now — jackpot roll takes the pool
              </span>
            ) : countdownMs !== null ? (
              <>vault opens in {formatCountdown(countdownMs)} — beta time</>
            ) : (
              <>vault opens soon — beta time</>
            )}
          </div>
        </div>
      </div>
      {variant === "boarded" && <Planks />}
    </div>
  );
}
