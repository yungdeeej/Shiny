"use client";

/**
 * /cred — Street Cred tier ladder (specs/01). Perks are status and access,
 * never yield. Demo carries a BETA holding simulator standing in for the
 * "buy on Jupiter" flow.
 */
import {
  TIER_DEFINITIONS,
  TIER_ORDER,
  formatShiny,
  toBaseUnits,
  type CredTier,
} from "@trash-wars/shared";
import clsx from "clsx";
import React, { useState } from "react";
import { TIER_LABEL, TierBadge } from "../../components/game/TierBadge";
import { Button } from "../../components/ui/Button";
import { CountdownPill } from "../../components/ui/CountdownPill";
import { Skeleton } from "../../components/ui/Skeleton";
import { DEMO_V11 } from "../../lib/client/local/content";
import { useGameClientSafe } from "../../lib/client/provider";
import { useGameMutation, useMe } from "../../lib/hooks";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";
const LADDER: CredTier[] = TIER_ORDER.filter((t) => t !== "none");

/** Status/access framing only — copy rule from specs/01. */
function perkLines(tier: CredTier): string[] {
  const p = TIER_DEFINITIONS[tier].perks;
  const lines: string[] = [];
  if (tier === "alley") lines.push("Free-tier job access — your name gets around");
  lines.push(p.missionSlots === 1 ? "One crew on the street" : `${p.missionSlots} crews on the street at once`);
  lines.push(`Withdrawal fee ${(p.withdrawalFeeBps / 100).toFixed(0)}%`);
  if (p.bailDiscountBps > 0) lines.push(`${p.bailDiscountBps / 100}% off bail — the desk sergeant knows you`);
  if (p.mintEarlyAccessHours > 0) lines.push(`${p.mintEarlyAccessHours}h early door at mint waves`);
  if (p.weeklyRaffleTickets > 0) lines.push("A raffle ticket on the house, weekly");
  if (p.penthouseAccess) lines.push("The Penthouse Job — the doorman steps aside");
  if (tier === "kingpin") lines.push("Seasonal council vote");
  return lines;
}

function TierRow({ tier, current, held }: { tier: CredTier; current: CredTier; held: bigint }) {
  const def = TIER_DEFINITIONS[tier];
  const isCurrent = tier === current;
  const reached = held >= def.minHeld;
  return (
    <div
      className={clsx(
        "card relative flex gap-4 p-4 transition-colors",
        isCurrent ? "border-accent/70 shadow-glow-amber" : reached ? "border-success/30" : "opacity-80",
      )}
    >
      {/* ladder rail */}
      <div className="flex flex-col items-center" aria-hidden>
        <span
          className={clsx(
            "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-black",
            isCurrent ? "border-accent bg-accent/15 text-accent" : reached ? "border-success/60 text-success" : "border-line text-muted",
          )}
        >
          {reached ? "✓" : TIER_ORDER.indexOf(tier)}
        </span>
        {tier !== "kingpin" && <span className="mt-1 w-0.5 flex-1 bg-line" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={tier} asLink={false} />
          <span className="text-xs text-muted">
            hold {formatShiny(def.minHeld, { compact: true })} $SHINY
          </span>
          {isCurrent && <span className="noir-label !text-accent">← you are here</span>}
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {perkLines(tier).map((l) => (
            <li key={l} className="flex items-start gap-1.5">
              <span className="text-accent" aria-hidden>▸</span>
              {l}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function CredPage() {
  const { data: me } = useMe();
  const client = useGameClientSafe();
  const [customWhole, setCustomWhole] = useState("");

  const simulate = useGameMutation(
    (c, amount: string) => {
      if (!c.simulateHolding) return Promise.reject(new Error("Simulator only exists in the beta."));
      return c.simulateHolding(amount);
    },
    ["me", "locations", "missions"],
    { successToast: (m) => `Wallet now holds ${formatShiny(m.cred?.heldBalance ?? "0", { compact: true })} $SHINY — ${TIER_LABEL[m.cred?.tier ?? "none"]}.` },
  );

  const cred = me?.cred;
  if (!me) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (!cred) {
    // no-wallet / pre-rollout state: show the ladder, no personal standing
    return (
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-2xl">Street Cred</h1>
          <p className="text-sm text-muted">
            The city respects what your wallet holds. Connect a wallet holding $SHINY to claim a tier —
            status and access, never yield.
          </p>
        </div>
        <div className="space-y-2.5">
          {LADDER.map((t) => (
            <TierRow key={t} tier={t} current="none" held={0n} />
          ))}
        </div>
      </div>
    );
  }

  const held = BigInt(cred.heldBalance);
  const canSimulate = DEMO && !!client?.simulateHolding;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl">
          Street Cred <TierBadge tier={cred.tier} asLink={false} />
        </h1>
        <p className="text-sm text-muted">
          The city respects what your wallet holds. Status and access — never yield. Holdings stay in
          YOUR wallet, on-chain, never deposited.
        </p>
      </div>

      {/* current standing + shortfall callout */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="noir-label">held in wallet</div>
            <div className="font-display text-2xl text-accent2">{formatShiny(held)} <span className="text-sm text-accent">✦</span></div>
          </div>
          {cred.nextTier && cred.shortfall && BigInt(cred.shortfall) > 0n && (
            <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm">
              Hold <span className="font-bold text-accent">{formatShiny(cred.shortfall)}</span> more $SHINY to
              reach <span className="font-bold">{TIER_LABEL[cred.nextTier]}</span>.
            </div>
          )}
        </div>
        {cred.graceUntil && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            <span aria-hidden>⏳</span> Wallet dipped below your tier. Cred holds for a grace window —
            <CountdownPill until={cred.graceUntil} className="border-danger/40 text-danger" />
            <span className="text-[10px] text-muted">(24h on mainnet · 2 real min in beta)</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="https://jup.ag/swap/SOL-SHINY"
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={DEMO}
            onClick={(e) => DEMO && e.preventDefault()}
            title={DEMO ? "Disabled in the beta — use the holding simulator below." : "Swap SOL for $SHINY on Jupiter"}
            className={clsx(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold",
              DEMO
                ? "cursor-not-allowed border border-line bg-surface2 text-muted"
                : "bg-accent text-bg shadow-glow-amber hover:bg-accent2",
            )}
          >
            🪐 Buy $SHINY on Jupiter
            {DEMO && <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide">disabled in beta</span>}
          </a>
        </div>
      </div>

      {/* BETA holding simulator */}
      {canSimulate && (
        <div className="card space-y-3 border-jackpot/40 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-jackpot/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-jackpot">
              beta only
            </span>
            <span className="noir-label">holding simulator</span>
          </div>
          <p className="text-xs text-muted">
            No wallets in the open beta — this slider stands in for buying on Jupiter. Set what your
            wallet &ldquo;holds&rdquo; and watch the tier change. Downgrades wait out the grace window; upgrades are instant.
          </p>
          <div className="flex flex-wrap gap-2">
            {DEMO_V11.holdingPresets.map((whole) => {
              const active = held === toBaseUnits(whole);
              return (
                <button
                  key={whole}
                  onClick={() => simulate.mutate(toBaseUnits(whole).toString())}
                  disabled={simulate.isPending}
                  className={clsx(
                    "rounded-xl border px-3.5 py-2 text-sm font-bold tabular-nums",
                    active ? "border-accent bg-accent/15 text-accent" : "border-line bg-surface2 hover:border-accent/50",
                  )}
                >
                  {whole.toLocaleString("en-US")} ✦
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={customWhole}
              onChange={(e) => setCustomWhole(e.target.value)}
              placeholder="custom amount (whole $SHINY)"
              className="flex-1 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent/60"
              aria-label="Custom simulated holding in whole SHINY"
            />
            <Button
              variant="ghost"
              disabled={simulate.isPending || customWhole.trim() === "" || !(Number(customWhole) >= 0)}
              onClick={() => {
                try {
                  simulate.mutate(toBaseUnits(customWhole.trim()).toString());
                } catch {
                  /* unparseable input — leave the field as-is */
                }
              }}
            >
              Set
            </Button>
          </div>
        </div>
      )}

      {/* the ladder */}
      <div className="space-y-2">
        <div className="noir-label">The ladder — perks are cumulative</div>
        <div className="space-y-2.5">
          {LADDER.map((t) => (
            <TierRow key={t} tier={t} current={cred.tier} held={held} />
          ))}
        </div>
      </div>

      <p className="text-center text-[10px] text-muted/60">
        Tier thresholds move only with 7 days&apos; public notice. Downgrades apply after a 24h grace
        window (2 real minutes in beta); upgrades are instant.
      </p>
    </div>
  );
}
