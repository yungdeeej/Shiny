"use client";

/**
 * Street Cred tier chip (specs/01) — tier name + colored ring, lives next to
 * the BalancePill in the TopBar and links to /cred.
 */
import type { CredTier } from "@trash-wars/shared";
import clsx from "clsx";
import Link from "next/link";
import React from "react";

export const TIER_LABEL: Record<CredTier, string> = {
  none: "No Cred",
  alley: "Alley",
  block: "Block",
  district: "District",
  borough: "Borough",
  kingpin: "Kingpin",
};

/** ring + text colors per tier: slate → bronze → silver → gold → amber/purple */
export const TIER_STYLE: Record<CredTier, { ring: string; text: string; glow?: string }> = {
  none: { ring: "border-line", text: "text-muted" },
  alley: { ring: "border-[#8A94A6]/60", text: "text-[#aeb7c6]" },
  block: { ring: "border-[#CD7F32]/70", text: "text-[#e0a05f]" },
  district: { ring: "border-[#c9d3e0]/70", text: "text-[#dfe6ef]" },
  borough: { ring: "border-accent/80", text: "text-accent" },
  kingpin: {
    ring: "border-jackpot/80",
    text: "text-jackpot",
    glow: "shadow-[0_0_14px_-2px_rgba(199,146,234,0.55),0_0_10px_-4px_rgba(255,182,39,0.5)]",
  },
};

const TIER_DOT: Record<CredTier, string> = {
  none: "#3a4255",
  alley: "#8A94A6",
  block: "#CD7F32",
  district: "#c9d3e0",
  borough: "#FFB627",
  kingpin: "#C792EA",
};

export function TierBadge({ tier, className, asLink = true }: { tier: CredTier; className?: string; asLink?: boolean }) {
  const s = TIER_STYLE[tier];
  const body = (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border-2 bg-surface px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
        s.ring,
        s.text,
        s.glow,
        className,
      )}
      title={`Street Cred: ${TIER_LABEL[tier]}`}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: TIER_DOT[tier], boxShadow: `0 0 6px ${TIER_DOT[tier]}` }}
        aria-hidden
      />
      {TIER_LABEL[tier]}
    </span>
  );
  if (!asLink) return body;
  return (
    <Link href="/cred" aria-label={`Street Cred tier: ${TIER_LABEL[tier]}`} className="shrink-0">
      {body}
    </Link>
  );
}
