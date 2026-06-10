"use client";

import {
  applyBribe,
  applyPatrolModifiers,
  applyStatModifiers,
  computePayoutEvBps,
  insurancePrice,
} from "@trash-wars/economy";
import {
  POLICY,
  TIER_DEFINITIONS,
  ZERO_STATS,
  formatShiny,
  nextTier,
  toBaseUnits,
  type Character,
  type CredTier,
  type LocationLive,
  type Mission,
} from "@trash-wars/shared";
import clsx from "clsx";
import Link from "next/link";
import React, { useMemo, useState } from "react";
import { LOCAL_POLICY } from "../../lib/client/local/content";
import { useCharacters, useGameMutation, useMe, useMissions, usePass } from "../../lib/hooks";
import { TIER_LABEL } from "./TierBadge";
import { formatGameDuration } from "../../lib/time";
import { useUiStore } from "../../lib/uiStore";
import { CharacterAvatar } from "../art/CharacterAvatar";
import { Button } from "../ui/Button";
import { CountdownPill } from "../ui/CountdownPill";
import { HeatBadge } from "../ui/HeatBadge";
import { ProbabilityTable } from "../ui/ProbabilityTable";
import { Sheet } from "../ui/Sheet";
import { TokenAmount } from "../ui/TokenAmount";

function GuideTip({ children, show }: { children: React.ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <div className="animate-pulse-soft rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs text-accent2">
      {children}
    </div>
  );
}

/** First tier above `tier` that adds a mission slot (slot-limit upsell copy). */
function slotUnlockTier(tier: CredTier): { tier: CredTier; slots: number } | null {
  const current = TIER_DEFINITIONS[tier].perks.missionSlots;
  let t = nextTier(tier);
  while (t && TIER_DEFINITIONS[t].perks.missionSlots <= current) t = nextTier(t);
  return t ? { tier: t, slots: TIER_DEFINITIONS[t].perks.missionSlots } : null;
}

export function MissionSheet({ location, open, onClose }: {
  location: LocationLive | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const { data: characters } = useCharacters();
  const { data: missions } = useMissions();
  const { data: pass } = usePass();
  const guided = useUiStore((s) => s.guided);
  const setGuided = useUiStore((s) => s.setGuided);

  const [selected, setSelected] = useState<string | "free" | null>(null);
  const [stakeWhole, setStakeWhole] = useState("");
  const [insured, setInsured] = useState(false);
  const [useVoucher, setUseVoucher] = useState(false);
  const [bribed, setBribed] = useState(false);
  const [pending, setPending] = useState<Mission | null>(null);

  // v1.1 Street Cred: concurrent mission slots
  const slots = me?.cred?.perks.missionSlots ?? 1;
  const activeJobs = missions?.active.length ?? 0;
  const slotsFull = activeJobs >= slots;
  const slotUpsell = me?.cred ? slotUnlockTier(me.cred.tier) : null;
  const vouchers = pass?.insuranceVouchers ?? 0;

  const loc = location;
  const eligible: Character[] = (characters ?? []).filter((c) => c.faction !== "bloodhound" && c.inGame && c.status !== "dead");
  const selectedChar = selected !== "free" ? eligible.find((c) => c.id === selected) : undefined;
  const stats = selectedChar?.stats ?? ZERO_STATS;

  const balance = me ? BigInt(me.balance) : 0n;
  const stake = useMemo(() => {
    try {
      const v = stakeWhole.trim() === "" ? 0n : toBaseUnits(stakeWhole.trim());
      return v < 0n ? 0n : v;
    } catch {
      return 0n;
    }
  }, [stakeWhole]);

  const maxStake = useMemo(() => {
    if (!loc) return 0n;
    let m = BigInt(loc.maxStake);
    if (selected === "free" && POLICY.freeTierMaxStake < m) m = POLICY.freeTierMaxStake;
    if (balance < m) m = balance;
    return m;
  }, [loc, selected, balance]);

  /** Patrol weight inferred from the live effective table (arrest delta / 80). */
  const patrolWeight = useMemo(() => {
    if (!loc) return 0;
    const baseArrest = loc.table.find((r) => r.outcome === "arrest")?.probabilityBps ?? 0;
    const effArrest = loc.effectiveTable.find((r) => r.outcome === "arrest")?.probabilityBps ?? 0;
    return Math.max(0, (effArrest - baseArrest) / 80);
  }, [loc]);

  const preview = useMemo(() => {
    if (!loc) return null;
    const withStats = applyStatModifiers(loc.table, stats);
    let t = applyPatrolModifiers(withStats, patrolWeight, loc);
    if (bribed) t = applyBribe(t, withStats);
    return t;
  }, [loc, stats, patrolWeight, bribed]);

  const evBps = preview ? computePayoutEvBps(preview) : 10_000;
  const ev = evBps / 10_000;
  const insPrice = loc && loc.rektCapable ? insurancePrice(stake, loc) : 0n;
  const bribePrice = (stake * BigInt(LOCAL_POLICY.bribePriceBps)) / 10_000n;

  const start = useGameMutation(
    async (c, args: { locationSlug: string; characterId?: string; stake: string }) => {
      const m = await c.startMission(args);
      if (insured) await c.buyInsurance(m.id, { useVoucher: useVoucher && vouchers > 0 }).catch(() => undefined);
      if (bribed) await c.bribe(m.id).catch(() => undefined);
      return m;
    },
    ["missions", "me", "characters", "locations", "pass"],
    {
      onSuccess: (m) => {
        setPending(m);
        setGuided(false);
      },
    },
  );

  const stakeValid =
    loc !== null && stake >= BigInt(loc.minStake) && stake <= maxStake && stake > 0n;
  const charValid = selected === "free" ? loc?.freeTierAllowed : !!selectedChar && selectedChar.status === "idle";
  const insCost = insured && !(useVoucher && vouchers > 0) ? insPrice : 0n;
  const totalCost = stake + insCost + (bribed ? bribePrice : 0n);
  const canConfirm = stakeValid && !!charValid && totalCost <= balance && !slotsFull && !start.isPending;

  const reset = () => {
    setPending(null);
    setSelected(null);
    setStakeWhole("");
    setInsured(false);
    setUseVoucher(false);
    setBribed(false);
  };

  return (
    <Sheet
      open={open && !!loc}
      onClose={() => {
        reset();
        onClose();
      }}
      title={
        loc && (
          <span className="flex items-center gap-2.5">
            {loc.name} <HeatBadge band={loc.heat} />
          </span>
        )
      }
      wide
    >
      {loc && pending === null && (
        <div className="space-y-5">
          <p className="text-sm italic text-muted">&ldquo;{loc.tagline}&rdquo;</p>

          {/* v1.1 — Street Cred slot limit */}
          {slotsFull && (
            <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm" role="alert">
              <span className="font-bold text-danger">All crews are out.</span>{" "}
              <span className="text-muted">
                {activeJobs}/{slots} job{slots > 1 ? "s" : ""} running.
                {slotUpsell ? (
                  <>
                    {" "}Street Cred <Link href="/cred" className="font-bold text-accent underline">{TIER_LABEL[slotUpsell.tier]}</Link>{" "}
                    unlocks {slotUpsell.slots === 2 ? "a second job" : `${slotUpsell.slots} concurrent jobs`}.
                  </>
                ) : (
                  " Wait for one to land."
                )}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span className="rounded-full bg-surface2 px-2.5 py-1">{formatGameDuration(loc.durationHours)}</span>
            <span className="rounded-full bg-surface2 px-2.5 py-1">{loc.playersActive} crews active</span>
            <span className="rounded-full bg-surface2 px-2.5 py-1">
              stake {formatShiny(loc.minStake, { compact: true })}–{formatShiny(loc.maxStake, { compact: true })} ✦
            </span>
          </div>

          {/* character select */}
          <div>
            <div className="noir-label mb-2">Send who?</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {loc.freeTierAllowed && (
                <button
                  onClick={() => setSelected("free")}
                  className={clsx(
                    "flex w-24 shrink-0 flex-col items-center gap-1 rounded-xl border p-2 text-xs",
                    selected === "free" ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface2 text-muted hover:border-muted/50",
                  )}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-xl">🎟️</span>
                  Free Tier
                  <span className="text-[9px]">no crew · 8h cd</span>
                </button>
              )}
              {eligible.map((c) => {
                const busy = c.status !== "idle";
                return (
                  <button
                    key={c.id}
                    disabled={busy}
                    onClick={() => setSelected(c.id)}
                    className={clsx(
                      "flex w-24 shrink-0 flex-col items-center gap-1 rounded-xl border p-2 text-xs",
                      selected === c.id ? "border-accent bg-accent/10" : "border-line bg-surface2 hover:border-muted/50",
                      busy && "opacity-40",
                    )}
                  >
                    <CharacterAvatar dna={c.dna} faction={c.faction} cosmetics={c.cosmetics} size={48} />
                    <span className="w-full truncate text-center">{c.name}</span>
                    <span className="text-[9px] text-muted">{busy ? c.status.replace("_", " ") : `S${c.stats.stealth} M${c.stats.muscle} L${c.stats.luck}`}</span>
                  </button>
                );
              })}
              {eligible.length === 0 && !loc.freeTierAllowed && (
                <p className="py-3 text-sm text-muted">
                  No crew available. <Link className="text-accent underline" href="/den">Visit the den.</Link>
                </p>
              )}
            </div>
          </div>

          {/* stake */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="noir-label">Stake</span>
              <GuideTip show={guided && stake === 0n}>1 · Put some skin in the game</GuideTip>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2.5 focus-within:border-accent/60">
                <span className="text-accent">✦</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={stakeWhole}
                  onChange={(e) => setStakeWhole(e.target.value)}
                  placeholder={`min ${formatShiny(loc.minStake)}`}
                  className="w-full bg-transparent text-base font-semibold outline-none placeholder:text-muted/60"
                  aria-label="Stake amount in SHINY"
                />
              </div>
            </div>
            <div className="mt-2 flex gap-1.5">
              {[25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setStakeWhole(String((maxStake * BigInt(pct)) / 100n / 1_000_000n))}
                  className="rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-muted hover:border-accent/50 hover:text-accent"
                >
                  {pct}%
                </button>
              ))}
              <button
                onClick={() => setStakeWhole(String(maxStake / 1_000_000n))}
                className="rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent"
              >
                MAX
              </button>
            </div>
            {stake > 0n && !stakeValid && (
              <p className="mt-1.5 text-xs text-danger">
                Stake must be {formatShiny(loc.minStake)}–{formatShiny(maxStake)} ✦{selected === "free" ? " (free-tier cap 5,000)" : ""}.
              </p>
            )}
          </div>

          {/* odds */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="noir-label">Tonight&apos;s odds</span>
              <GuideTip show={guided && stake > 0n}>2 · Read the table. It can&apos;t change after you bet.</GuideTip>
            </div>
            {preview && <ProbabilityTable table={preview} base={loc.table} />}
            <p className="mt-2 text-xs text-muted">
              Expected: <span className={clsx("font-bold", ev >= 1 ? "text-success" : "text-accent")}>{ev.toFixed(2)}×</span>
              {" — "}
              {ev >= 1 ? "the city likes you tonight" : "the house respects you"}
              {patrolWeight > 0.5 && <span> · patrols are pressing the odds</span>}
            </p>
          </div>

          {/* insurance + bribe */}
          <div className="space-y-2">
            {loc.rektCapable && (
              <div className={clsx("rounded-xl border", insured ? "border-success/50 bg-success/5" : "border-line bg-surface2")}>
                <label className="flex cursor-pointer items-center justify-between px-4 py-3">
                  <span>
                    <span className="block text-sm font-semibold">Rekt insurance</span>
                    <span className="block text-xs text-muted">Character survives a fatal roll. Premium burns.</span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    {useVoucher && vouchers > 0 ? (
                      <span className="text-xs font-bold text-success">voucher — free</span>
                    ) : (
                      <TokenAmount amount={insPrice} className="text-xs" />
                    )}
                    <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} className="h-4 w-4 accent-[#3DDC97]" />
                  </span>
                </label>
                {/* v1.1 — season pass insurance voucher */}
                {insured && vouchers > 0 && (
                  <label className="flex cursor-pointer items-center justify-between border-t border-line/60 px-4 py-2.5">
                    <span className="flex items-center gap-2 text-xs">
                      <span aria-hidden>🛡️</span>
                      <span>
                        Use a pass voucher <span className="text-muted">({vouchers} left · covers it, no burn)</span>
                      </span>
                    </span>
                    <input type="checkbox" checked={useVoucher} onChange={(e) => setUseVoucher(e.target.checked)} className="h-4 w-4 accent-[#3DDC97]" />
                  </label>
                )}
              </div>
            )}
            {loc.heat !== "none" && (
              <label className={clsx("flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3", bribed ? "border-accent/50 bg-accent/5" : "border-line bg-surface2")}>
                <span>
                  <span className="block text-sm font-semibold">Bribe the patrol</span>
                  <span className="block text-xs text-muted">Halves patrol pressure on arrest &amp; confiscation. 75% burns.</span>
                </span>
                <span className="flex items-center gap-2.5">
                  <TokenAmount amount={bribePrice} className="text-xs" />
                  <input type="checkbox" checked={bribed} onChange={(e) => setBribed(e.target.checked)} className="h-4 w-4 accent-[#FFB627]" />
                </span>
              </label>
            )}
          </div>

          {/* confirm */}
          <div className="space-y-2 border-t border-line pt-4">
            <GuideTip show={guided && stakeValid === true && !!charValid}>3 · Pull the trigger.</GuideTip>
            <Button
              size="lg"
              className="w-full"
              disabled={!canConfirm}
              loading={start.isPending}
              onClick={() =>
                start.mutate({
                  locationSlug: loc.slug,
                  characterId: selected === "free" || selected === null ? undefined : selected,
                  stake: stake.toString(),
                })
              }
            >
              CONFIRM — stake <TokenAmount amount={stake} className="text-bg" glyphSize={14} />
              {insured || bribed ? <span className="text-xs font-normal opacity-80">(+{formatShiny(totalCost - stake, { compact: true })} extras)</span> : null}
            </Button>
            <p className="text-center text-[11px] text-muted">
              {selected === null ? "Pick who's going first." : totalCost > balance ? "You can't cover that." : `Total leaving your pocket: ${formatShiny(totalCost)} ✦`}
            </p>
          </div>
        </div>
      )}

      {loc && pending !== null && (
        <div className="space-y-5 py-6 text-center">
          <div className="text-5xl" aria-hidden>🕶️</div>
          <h3 className="font-display text-2xl">The job is on.</h3>
          <p className="text-sm text-muted">
            {selectedChar?.name ?? "Your freelancer"} slipped into {loc.name}. Outcome locks the moment the seed was committed — nobody can move the cards now.
          </p>
          <div className="flex justify-center">
            <CountdownPill until={pending.resolvesAt} prefix="resolves in " className="px-4 py-2 text-sm" />
          </div>
          <div className="card mx-auto max-w-sm p-3 text-left">
            <div className="noir-label mb-1">seed committed</div>
            <Link href={`/verify?mission=${pending.id}`} className="break-all font-mono text-xs text-pd underline">
              {pending.serverSeedHash.slice(0, 16)}…
            </Link>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Wander the city while you wait
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
