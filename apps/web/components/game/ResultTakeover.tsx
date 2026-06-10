"use client";

import type { Character, Mission, MissionResult } from "@trash-wars/shared";
import { formatShiny } from "@trash-wars/shared";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { CharacterAvatar } from "../art/CharacterAvatar";
import { ShinyGlyph } from "../art/Logo";
import { Button } from "../ui/Button";

/** rAF count-up for payout reveals. */
function CountUp({ to, duration = 1.4 }: { to: bigint; duration?: number }) {
  const [val, setVal] = useState(0);
  const target = Number(to / 1_000_000n);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / (duration * 1000));
      setVal(Math.floor(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return <span className="tabular-nums">{val.toLocaleString("en-US")}</span>;
}

function ConfettiShiny() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 26 }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute text-xl"
          style={{ left: `${(i * 37) % 100}%`, color: i % 3 === 0 ? "#FFD56B" : i % 3 === 1 ? "#C792EA" : "#FFB627" }}
          initial={{ y: -40, opacity: 0, rotate: 0 }}
          animate={{ y: "110vh", opacity: [0, 1, 1, 0.6], rotate: 360 + i * 40 }}
          transition={{ duration: 3 + (i % 5) * 0.5, delay: (i % 7) * 0.18, ease: "linear" }}
        >
          ✦
        </motion.span>
      ))}
    </div>
  );
}

function MugshotFrame({ character }: { character: Character | null }) {
  return (
    <div className="relative mx-auto w-fit">
      <div className="relative rounded-xl border-4 border-[#2a3550] bg-[#1b2335] p-3">
        {/* height lines */}
        <div className="absolute inset-x-3 top-3 bottom-3" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-dashed border-[#3a4763]" style={{ top: `${i * 22}%` }} />
          ))}
        </div>
        {character ? (
          <CharacterAvatar dna={character.dna} faction={character.faction} cosmetics={character.cosmetics} size={150} className="relative" />
        ) : (
          <div className="relative flex h-[150px] w-[150px] items-center justify-center text-5xl">🦝</div>
        )}
        <div className="relative mt-2 bg-[#0c1018] px-3 py-1 text-center font-mono text-[11px] tracking-widest text-muted">
          SHOREFRONT PD · {character?.name?.toUpperCase() ?? "FREELANCER"}
        </div>
      </div>
      <motion.div
        className="absolute -right-7 top-5 rotate-12 rounded border-2 border-pd px-2 py-1 font-mono text-xs font-bold tracking-widest text-pd"
        initial={{ scale: 2.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.5, type: "spring", damping: 12 }}
      >
        BOOKED — 24H
      </motion.div>
    </div>
  );
}

/** Gold vault door swinging open — the pool-win moment (specs/03). */
function VaultDoorOpen() {
  const reduced = useReducedMotion();
  return (
    <div className="relative mx-auto h-[150px] w-[150px]" style={{ perspective: 600 }}>
      {/* vault interior glow */}
      <div className="absolute inset-2 rounded-full bg-[radial-gradient(circle,rgba(255,213,107,0.55),rgba(255,182,39,0.12)_70%)]" />
      <svg viewBox="0 0 150 150" className="absolute inset-0" aria-hidden>
        <circle cx="75" cy="75" r="70" fill="none" stroke="#7a5a16" strokeWidth="8" />
        <circle cx="75" cy="75" r="62" fill="none" stroke="#FFB627" strokeWidth="2" opacity="0.6" />
      </svg>
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: "left center" }}
        initial={reduced ? { rotateY: -75 } : { rotateY: 0 }}
        animate={{ rotateY: -75 }}
        transition={{ delay: 0.4, duration: 1.1, ease: [0.7, 0, 0.3, 1] }}
      >
        <svg viewBox="0 0 150 150" className="h-full w-full" aria-hidden>
          <circle cx="75" cy="75" r="64" fill="#2b2410" stroke="#FFB627" strokeWidth="4" />
          <circle cx="75" cy="75" r="40" fill="none" stroke="#FFD56B" strokeWidth="3" opacity="0.9" />
          <g stroke="#FFD56B" strokeWidth="5" strokeLinecap="round">
            <line x1="75" y1="44" x2="75" y2="106" />
            <line x1="44" y1="75" x2="106" y2="75" />
            <line x1="53" y1="53" x2="97" y2="97" />
            <line x1="97" y1="53" x2="53" y2="97" />
          </g>
          <circle cx="75" cy="75" r="9" fill="#FFB627" />
          {[30, 90, 150, 210, 270, 330].map((deg) => (
            <circle
              key={deg}
              cx={75 + 54 * Math.cos((deg * Math.PI) / 180)}
              cy={75 + 54 * Math.sin((deg * Math.PI) / 180)}
              r="3"
              fill="#FFB627"
            />
          ))}
        </svg>
      </motion.div>
    </div>
  );
}

function EvidenceBag({ amount }: { amount: string }) {
  return (
    <div className="relative mx-auto w-fit">
      <svg width="180" height="200" viewBox="0 0 180 200" aria-hidden>
        <path d="M 30 36 L 150 36 L 162 188 L 18 188 Z" fill="#2a2417" stroke="#FF8A3C" strokeWidth="3" />
        <path d="M 30 36 L 150 36 L 148 50 L 32 50 Z" fill="#FF8A3C" opacity="0.85" />
        <rect x="50" y="20" width="80" height="16" rx="4" fill="#3a3220" stroke="#FF8A3C" strokeWidth="2" />
        <text x="90" y="78" textAnchor="middle" fontFamily="monospace" fontSize="13" fontWeight="800" fill="#FF8A3C" letterSpacing="2">
          PD EVIDENCE
        </text>
        <line x1="40" y1="88" x2="140" y2="88" stroke="#FF8A3C" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="90" y="120" textAnchor="middle" fontFamily="monospace" fontSize="11" fill="#c9a27a">CASE NO. 4-1187</text>
      </svg>
      <div className="absolute inset-x-0 top-[130px] text-center">
        <span className="inline-flex items-center gap-1 font-display text-lg text-[#FF8A3C]">
          <ShinyGlyph size={16} /> {formatShiny(amount, { compact: true })}
        </span>
      </div>
    </div>
  );
}

export interface ResultTakeoverProps {
  mission: Mission;
  result: MissionResult;
  locationName: string;
  character: Character | null;
  handle: string;
  onClose: () => void;
  onVerify: () => void;
}

export function ResultTakeover({ mission, result, locationName, character, handle, onClose, onVerify }: ResultTakeoverProps) {
  const reduced = useReducedMotion();
  const mult = typeof result.detail?.multiplierBps === "number" ? result.detail.multiplierBps / 10_000 : null;
  const saved = result.detail?.insuranceSaved === true;
  const stake = BigInt(mission.stake);
  const payout = BigInt(result.payout);
  const profit = payout - stake;
  /** v1.1 — set when the same roll ALSO won the progressive pool. */
  const poolWon =
    typeof result.detail?.jackpotPool === "string" && /^\d+$/.test(result.detail.jackpotPool)
      ? BigInt(result.detail.jackpotPool)
      : null;

  const shareText = (() => {
    switch (result.outcome) {
      case "jackpot":
        return poolWon !== null
          ? `THE VAULT IS MINE — I cracked The Mint's progressive jackpot for ${formatShiny(poolWon, { compact: true })} $SHINY in Trash Wars 🏦💎🦝`
          : `I just hit the ${mult?.toFixed(0)}× JACKPOT at ${locationName} in Trash Wars 💎🦝 $SHINY`;
      case "win":
        return `Hit ${mult?.toFixed(1)}× at ${locationName} in Trash Wars 🦝 +${formatShiny(profit, { compact: true })} $SHINY`;
      case "arrest":
        return `Got booked at ${locationName} in Trash Wars 🚔 24 hours in the tank.`;
      case "rekt_character":
        return saved
          ? `Nearly died at ${locationName} in Trash Wars — insurance pulled me out 🏥`
          : `My raccoon didn't make it out of ${locationName} in Trash Wars 💀 F`;
      default:
        return `Running jobs in Shorefront City — Trash Wars 🦝 $SHINY`;
    }
  })();
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  const shake =
    !reduced && (result.outcome === "jackpot" || result.outcome === "rekt_character" || result.outcome === "rekt_items")
      ? { x: [0, -8, 9, -6, 5, -2, 0], transition: { duration: 0.5, delay: 0.15 } }
      : {};

  let body: React.ReactNode;
  let wash = "";
  switch (result.outcome) {
    case "win":
      wash = "bg-[radial-gradient(circle_at_50%_42%,rgba(255,182,39,0.28),transparent_60%)]";
      body = (
        <>
          <motion.div
            className="mx-auto mb-4 w-fit -rotate-6 rounded-lg border-4 border-accent px-4 py-1 font-display text-2xl text-accent"
            initial={{ scale: 2.6, opacity: 0, rotate: -20 }}
            animate={{ scale: 1, opacity: 1, rotate: -6 }}
            transition={{ type: "spring", damping: 11, delay: 0.1 }}
          >
            {mult?.toFixed(1)}×
          </motion.div>
          <h2 className="font-display text-4xl text-accent">CLEAN GETAWAY</h2>
          <p className="mt-2 text-muted">{locationName} never saw it coming.</p>
          <p className="mt-6 inline-flex items-center gap-2 font-display text-5xl text-accent2">
            <ShinyGlyph size={36} /> <CountUp to={payout} />
          </p>
          <p className="mt-1 text-sm text-success">+{formatShiny(profit, { compact: true })} profit</p>
        </>
      );
      break;
    case "jackpot":
      if (poolWon !== null) {
        // v1.1 `vault` variant — the progressive pool payout dominates
        wash = "bg-[radial-gradient(circle_at_50%_38%,rgba(255,182,39,0.45),rgba(255,213,107,0.1),transparent_72%)]";
        body = (
          <>
            <ConfettiShiny />
            <VaultDoorOpen />
            <h2 className="mt-4 font-display text-5xl text-accent drop-shadow-[0_0_28px_rgba(255,182,39,0.8)]">
              THE VAULT IS YOURS
            </h2>
            <p className="mt-1 text-sm uppercase tracking-[0.3em] text-accent2/80">The Mint&apos;s pool, emptied to the floor</p>
            <p className="mt-5 inline-flex items-center gap-2 font-display text-7xl text-accent2">
              <ShinyGlyph size={48} /> <CountUp to={poolWon} duration={2.6} />
            </p>
            <p className="mt-3 text-sm text-muted">
              plus the {mult?.toFixed(0)}× roll — <span className="font-bold text-jackpot">{formatShiny(payout, { compact: true })} ✦</span> on your stake
            </p>
          </>
        );
        break;
      }
      wash = "bg-[radial-gradient(circle_at_50%_40%,rgba(199,146,234,0.4),rgba(255,182,39,0.12),transparent_70%)]";
      body = (
        <>
          <ConfettiShiny />
          <h2 className="font-display text-5xl text-jackpot drop-shadow-[0_0_24px_rgba(199,146,234,0.7)]">
            THE MINT PAYS OUT
          </h2>
          <motion.div
            className="mx-auto mt-4 w-fit rotate-3 rounded-lg border-4 border-jackpot px-5 py-1 font-display text-3xl text-jackpot"
            initial={{ scale: 3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 10, delay: 0.25 }}
          >
            {mult?.toFixed(0)}× JACKPOT
          </motion.div>
          <p className="mt-6 inline-flex items-center gap-2 font-display text-6xl text-accent2">
            <ShinyGlyph size={42} /> <CountUp to={payout} duration={2} />
          </p>
        </>
      );
      break;
    case "nothing":
      wash = "bg-[radial-gradient(circle_at_50%_45%,rgba(138,148,166,0.12),transparent_60%)]";
      body = (
        <>
          <div className="mb-5 text-6xl" aria-hidden>🌧️</div>
          <h2 className="font-display text-3xl text-text">You got away with… nothing.</h2>
          <p className="mt-2 text-muted">Clean shoes though. Stake returned.</p>
          <p className="mt-5 inline-flex items-center gap-2 font-display text-2xl text-muted">
            <ShinyGlyph size={20} /> {formatShiny(stake, { compact: true })} back in your pocket
          </p>
        </>
      );
      break;
    case "arrest":
      wash = "bg-[radial-gradient(circle_at_50%_30%,rgba(77,157,224,0.3),transparent_65%)]";
      body = (
        <>
          {!reduced && (
            <motion.div
              className="pointer-events-none absolute inset-0"
              animate={{ backgroundColor: ["rgba(77,157,224,0)", "rgba(77,157,224,0.16)", "rgba(255,77,94,0.12)", "rgba(77,157,224,0)"] }}
              transition={{ duration: 1.1, repeat: 3 }}
              aria-hidden
            />
          )}
          <MugshotFrame character={character} />
          <h2 className="mt-5 font-display text-3xl text-pd">BUSTED</h2>
          <p className="mt-2 text-muted">
            Stake returned, but {character?.name ?? "your operative"} eats 24 hours. Bail is 1,500 ✦ at the Precinct.
          </p>
        </>
      );
      break;
    case "confiscation":
      wash = "bg-[radial-gradient(circle_at_50%_38%,rgba(255,138,60,0.25),transparent_62%)]";
      body = (
        <>
          <EvidenceBag amount={mission.stake} />
          <h2 className="mt-4 font-display text-3xl text-[#FF8A3C]">CONFISCATED</h2>
          <p className="mt-2 text-muted">The PD bagged your whole stake. The hounds eat tonight.</p>
        </>
      );
      break;
    case "rekt_items":
    case "rekt_character":
      wash = "bg-[radial-gradient(circle_at_50%_40%,rgba(255,77,94,0.3),transparent_62%)]";
      body = (
        <>
          <div className="relative mx-auto w-fit">
            {character ? (
              saved || result.outcome === "rekt_items" ? (
                <CharacterAvatar dna={character.dna} faction={character.faction} cosmetics={character.cosmetics} size={140} />
              ) : (
                <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0.35 }} transition={{ delay: 0.8, duration: 1.2 }}>
                  <CharacterAvatar dna={character.dna} faction={character.faction} cosmetics={character.cosmetics} size={140} dead />
                </motion.div>
              )
            ) : (
              <div className="text-6xl">💀</div>
            )}
          </div>
          <h2 className={clsx("mt-5 font-display text-4xl", saved ? "text-success" : "text-danger")}>
            {result.outcome === "rekt_items" && !saved ? "IT WENT WRONG" : saved ? "CLOSE CALL" : "DIDN'T MAKE IT"}
          </h2>
          {saved ? (
            <motion.div
              className="mx-auto mt-3 w-fit -rotate-3 rounded border-2 border-success px-3 py-1 font-mono text-sm font-bold tracking-widest text-success"
              initial={{ scale: 2.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.5, type: "spring", damping: 12 }}
            >
              INSURANCE PAID OUT — THEY&apos;RE ALIVE
            </motion.div>
          ) : (
            <p className="mt-2 text-muted">
              {result.outcome === "rekt_character"
                ? `${character?.name ?? "Your operative"} is gone. Stake split between the furnace and the PD.`
                : "Gear lost, stake gone. It happens to the best crews."}
            </p>
          )}
        </>
      );
      break;
  }

  return (
    <motion.div
      className={clsx("fixed inset-0 z-[75] flex items-center justify-center overflow-hidden bg-bg/95 backdrop-blur-sm", wash)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, ...shake }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal
      aria-label="Mission result"
    >
      <div className="relative mx-4 w-full max-w-lg text-center">
        {body}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="ghost" onClick={() => window.open(shareUrl, "_blank", "noopener")}>
            Share on 𝕏
          </Button>
          <Link href={`/verify?mission=${mission.id}`} onClick={onVerify}>
            <Button variant="ghost">Verify roll</Button>
          </Link>
          <Button onClick={onClose} autoFocus>
            Continue
          </Button>
        </div>
        <p className="mt-4 font-mono text-[10px] text-muted/60">
          {handle} · seed {result.serverSeed.slice(0, 12)}… · roll committed before you bet
        </p>
      </div>
    </motion.div>
  );
}
