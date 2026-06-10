"use client";

import { SEASON1_LOCATIONS, applyPatrolModifiers, sha256Hex } from "@trash-wars/economy";
import type { Character, HeatBand, Mission, MissionOutcome, MissionResult } from "@trash-wars/shared";
import Link from "next/link";
import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Logo, ShinyGlyph } from "../../components/art/Logo";
import { ResultTakeover } from "../../components/game/ResultTakeover";
import { SuspenseModal } from "../../components/game/SuspenseModal";
import { Button } from "../../components/ui/Button";
import { CharacterCard } from "../../components/ui/CharacterCard";
import { CountdownPill } from "../../components/ui/CountdownPill";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { HeatBadge } from "../../components/ui/HeatBadge";
import { ProbabilityTable } from "../../components/ui/ProbabilityTable";
import { Sheet } from "../../components/ui/Sheet";
import { CardSkeleton, Skeleton } from "../../components/ui/Skeleton";
import { StatBar } from "../../components/ui/StatBar";
import { ToastHost } from "../../components/ui/Toast";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { useUiStore } from "../../lib/uiStore";

const HEAT_BANDS: HeatBand[] = ["none", "low", "med", "high", "blazing"];
const COSMETIC_SETS = [
  [],
  ["hat-fedora"],
  ["hat-beanie", "coat-trench"],
  ["hat-crown", "mask-visor"],
  ["companion-pigeon", "coat-trench", "hat-fedora"],
  ["mask-visor", "companion-pigeon"],
];

const fakeChar = (faction: "raccoon" | "bloodhound", status: Character["status"], i: number): Character => ({
  id: `sink-${faction}-${i}`,
  name: faction === "raccoon" ? "Velvet Knuckles" : "Officer Rex",
  faction,
  level: 3,
  stats: { stealth: 4, muscle: 2, luck: 6, reputation: 3 },
  status,
  stationedAt: status === "idle" ? "pawn-shop" : null,
  jailedUntil: status === "jailed" ? new Date(Date.now() + 9 * 60_000).toISOString() : null,
  patrolEndsAt: status === "on_patrol" ? new Date(Date.now() + 4 * 60_000).toISOString() : null,
  nftMint: null,
  inGame: true,
  lastClaimedAt: null,
  dna: sha256Hex(`sink:${faction}:${i}`),
  cosmetics: COSMETIC_SETS[i % COSMETIC_SETS.length] ?? [],
});

const OUTCOMES: Array<{ outcome: MissionOutcome; label: string; insured?: boolean }> = [
  { outcome: "win", label: "WIN" },
  { outcome: "jackpot", label: "JACKPOT" },
  { outcome: "nothing", label: "NOTHING" },
  { outcome: "arrest", label: "ARREST" },
  { outcome: "confiscation", label: "CONFISCATED" },
  { outcome: "rekt_items", label: "REKT (items)" },
  { outcome: "rekt_character", label: "REKT (fatal)" },
  { outcome: "rekt_character", label: "REKT + insurance", insured: true },
];

function fakeResolution(outcome: MissionOutcome, insured: boolean): { mission: Mission; result: MissionResult } {
  const loc = SEASON1_LOCATIONS[5]!;
  const mission: Mission = {
    id: `sink-mission-${outcome}-${insured}`,
    locationSlug: loc.slug,
    characterId: "sink-raccoon-1",
    stake: "25000000000",
    state: "resolved",
    serverSeedHash: sha256Hex("sink"),
    clientSeed: "kitchen-sink",
    effectiveTable: loc.table,
    insurance: insured,
    bribed: false,
    startedAt: new Date().toISOString(),
    resolvesAt: new Date().toISOString(),
  };
  const payout =
    outcome === "win" ? "125000000000" : outcome === "jackpot" ? "300000000000" : outcome === "nothing" || outcome === "arrest" ? mission.stake : "0";
  const result: MissionResult = {
    missionId: mission.id,
    outcome,
    payout,
    serverSeed: sha256Hex("sink-seed"),
    detail: { multiplierBps: outcome === "jackpot" ? 120_000 : outcome === "win" ? 50_000 : null, insuranceSaved: insured || undefined },
  };
  return { mission, result };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-line pb-1.5 font-display text-lg text-accent">{title}</h2>
      {children}
    </section>
  );
}

export default function KitchenSinkPage() {
  const toast = useUiStore((s) => s.toast);
  const [takeover, setTakeover] = useState<{ mission: Mission; result: MissionResult } | null>(null);
  const [showCam, setShowCam] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const mintLoc = SEASON1_LOCATIONS[5]!;
  const pressedTable = applyPatrolModifiers(mintLoc.table, 6, mintLoc);

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
      <ToastHost />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Logo className="text-3xl" />
          <p className="mt-1 text-sm text-muted">Kitchen sink — every component, every state. QA &amp; screenshot page.</p>
        </div>
        <Link href="/" className="text-sm text-accent underline">← back to the city</Link>
      </header>

      <Section title="Result takeovers (the money shots)">
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((o) => (
            <Button key={o.label} variant="ghost" onClick={() => setTakeover(fakeResolution(o.outcome, o.insured ?? false))}>
              {o.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setShowCam(true)}>SECURITY CAM (3.5s)</Button>
        </div>
      </Section>

      <Section title="Avatars — 12 random dna">
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <CharacterAvatar key={i} dna={sha256Hex(`grid:${i}`)} faction={i % 4 === 3 ? "bloodhound" : "raccoon"} size={96} className="w-full" />
          ))}
        </div>
        <div className="noir-label pt-2">cosmetic layers</div>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {["hat-fedora", "hat-beanie", "hat-crown", "mask-visor", "coat-trench", "companion-pigeon"].map((slug) => (
            <div key={slug} className="text-center">
              <CharacterAvatar dna={sha256Hex("mannequin")} faction="raccoon" cosmetics={[slug]} size={96} className="w-full" />
              <span className="text-[9px] text-muted">{slug}</span>
            </div>
          ))}
        </div>
        <div className="noir-label pt-2">factions, sizes &amp; the dearly departed</div>
        <div className="flex flex-wrap items-end gap-3">
          <CharacterAvatar dna={sha256Hex("big-raccoon")} faction="raccoon" cosmetics={["hat-fedora", "coat-trench"]} size={200} />
          <CharacterAvatar dna={sha256Hex("big-hound")} faction="bloodhound" size={200} />
          <CharacterAvatar dna={sha256Hex("small")} faction="raccoon" size={48} />
          <CharacterAvatar dna={sha256Hex("dead")} faction="raccoon" size={96} dead />
        </div>
      </Section>

      <Section title="Heat bands">
        <div className="flex flex-wrap gap-2">
          {HEAT_BANDS.map((b) => (
            <HeatBadge key={b} band={b} />
          ))}
        </div>
      </Section>

      <Section title="Probability tables">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-4">
            <div className="noir-label mb-2">The Mint — base</div>
            <ProbabilityTable table={mintLoc.table} />
          </div>
          <div className="card p-4">
            <div className="noir-label mb-2">The Mint — under heavy patrol (deltas)</div>
            <ProbabilityTable table={pressedTable} base={mintLoc.table} />
          </div>
        </div>
      </Section>

      <Section title="Buttons & pills">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="pd">PD</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <CountdownPill until={new Date(Date.now() + 95_000).toISOString()} />
          <CountdownPill until={new Date(Date.now() + 6_000).toISOString()} />
          <TokenAmount amount={184_500_000_000n} />
          <TokenAmount amount="1250000" compact={false} />
          <ShinyGlyph size={24} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => toast("Neutral toast — rain keeps falling.")}>Toast info</Button>
          <Button variant="ghost" onClick={() => toast("Payout landed.", "success")}>Toast success</Button>
          <Button variant="ghost" onClick={() => toast("The PD took everything.", "danger")}>Toast danger</Button>
          <Button variant="ghost" onClick={() => setSheetOpen(true)}>Open sheet</Button>
        </div>
      </Section>

      <Section title="Stat bars">
        <div className="card max-w-md space-y-2 p-4">
          <StatBar label="Stealth" value={7} />
          <StatBar label="Muscle" value={3} color="bg-danger" />
          <StatBar label="Luck" value={10} color="bg-jackpot" />
          <StatBar label="Rep" value={0} color="bg-pd" />
        </div>
      </Section>

      <Section title="Character cards — every status">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CharacterCard character={fakeChar("raccoon", "idle", 1)} onClick={() => undefined} />
          <CharacterCard character={fakeChar("raccoon", "on_mission", 2)} onClick={() => undefined} />
          <CharacterCard character={fakeChar("raccoon", "jailed", 3)} onClick={() => undefined} />
          <CharacterCard character={fakeChar("bloodhound", "on_patrol", 4)} onClick={() => undefined} />
          <CharacterCard character={fakeChar("raccoon", "listed", 5)} onClick={() => undefined} />
          <CharacterCard character={fakeChar("raccoon", "dead", 0)} onClick={() => undefined} />
        </div>
      </Section>

      <Section title="Empty / error / loading">
        <div className="grid gap-3 md:grid-cols-3">
          <EmptyState line="Nothing but rain out here." hint="Empty states get one noir line each." />
          <ErrorState message="Synthetic failure for QA." retry={() => toast("Retried.")} />
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <CardSkeleton />
          </div>
        </div>
      </Section>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="A demo sheet">
        <p className="text-sm text-muted">Right-side panel on desktop, bottom drawer on mobile. Escape closes it.</p>
      </Sheet>

      <AnimatePresence>
        {showCam && <SuspenseModal locationName="The Mint" onDone={() => setShowCam(false)} />}
        {takeover && (
          <ResultTakeover
            mission={takeover.mission}
            result={takeover.result}
            locationName="The Mint"
            character={fakeChar(
              "raccoon",
              takeover.result.outcome === "rekt_character" && takeover.result.detail?.insuranceSaved !== true ? "dead" : "idle",
              1,
            )}
            handle="QA_Tester"
            onClose={() => setTakeover(null)}
            onVerify={() => setTakeover(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
