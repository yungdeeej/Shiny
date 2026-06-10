import { z } from "zod";

/** $SHINY uses 6 decimals. All money is bigint base units; wire format is a decimal string. */
export const SHINY_DECIMALS = 6;
export const SHINY_UNIT = 1_000_000n;

/** Wire-safe token amount: non-negative integer string of base units. */
export const tokenAmount = z.string().regex(/^\d+$/, "expected integer base-unit string");
export type TokenAmount = z.infer<typeof tokenAmount>;

export function toBaseUnits(whole: number | string): bigint {
  const s = typeof whole === "number" ? whole.toString() : whole;
  const [int = "0", frac = ""] = s.split(".");
  const fracPadded = (frac + "000000").slice(0, SHINY_DECIMALS);
  const neg = int.startsWith("-");
  const intAbs = neg ? int.slice(1) : int;
  const units = BigInt(intAbs || "0") * SHINY_UNIT + BigInt(fracPadded || "0");
  return neg ? -units : units;
}

/** Format base units to a human string, trimming trailing zeros. */
export function formatShiny(units: bigint | string, opts?: { compact?: boolean }): string {
  const v = typeof units === "string" ? BigInt(units) : units;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / SHINY_UNIT;
  const frac = abs % SHINY_UNIT;

  if (opts?.compact) {
    const n = Number(whole) + Number(frac) / 1e6;
    const fmt = (x: number, suffix: string) =>
      `${(neg ? -x : x).toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 2 : 1 })}${suffix}`;
    if (n >= 1_000_000_000) return fmt(n / 1_000_000_000, "B");
    if (n >= 1_000_000) return fmt(n / 1_000_000, "M");
    if (n >= 10_000) return fmt(n / 1_000, "K");
    return `${neg ? "-" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }

  const fracStr = frac === 0n ? "" : `.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${fracStr}`;
}

/** bps helper: amount * bps / 10_000 with bigint floor semantics. */
export function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(Math.round(bps))) / 10_000n;
}
