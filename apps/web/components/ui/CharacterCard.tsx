"use client";

import { SEASON1_LOCATIONS } from "@trash-wars/economy";
import type { Character } from "@trash-wars/shared";
import clsx from "clsx";
import React from "react";
import { CharacterAvatar } from "../art/CharacterAvatar";
import { CountdownPill } from "./CountdownPill";
import { StatBar } from "./StatBar";

function StatusChip({ c }: { c: Character }) {
  switch (c.status) {
    case "idle":
      return <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">READY</span>;
    case "on_mission":
      return <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">ON A JOB</span>;
    case "jailed":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full bg-pd/15 px-2 py-0.5 text-[10px] font-bold text-pd">JAILED</span>
          {c.jailedUntil && <CountdownPill until={c.jailedUntil} />}
        </span>
      );
    case "on_patrol":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full bg-pd/15 px-2 py-0.5 text-[10px] font-bold text-pd">ON PATROL</span>
          {c.patrolEndsAt && <CountdownPill until={c.patrolEndsAt} />}
        </span>
      );
    case "listed":
      return <span className="rounded-full bg-jackpot/15 px-2 py-0.5 text-[10px] font-bold text-jackpot">LISTED</span>;
    case "dead":
      return <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">DECEASED</span>;
  }
}

export function CharacterCard({
  character: c,
  onClick,
  selected = false,
  compact = false,
}: {
  character: Character;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
}) {
  const station = c.stationedAt ? SEASON1_LOCATIONS.find((l) => l.slug === c.stationedAt) : null;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={clsx(
        "card w-full p-3 text-left transition-all",
        onClick && "hover:border-accent/50 hover:shadow-glow-amber",
        selected && "border-accent shadow-glow-amber",
        c.status === "dead" && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <CharacterAvatar dna={c.dna} faction={c.faction} cosmetics={c.cosmetics} size={compact ? 48 : 64} dead={c.status === "dead"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-sm">{c.name}</span>
            <span
              className={clsx(
                "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                c.faction === "bloodhound" ? "bg-pd/20 text-pd" : "bg-accent/15 text-accent",
              )}
            >
              {c.faction}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            Lv {c.level}
            {station && <span> · stationed at {station.name}</span>}
          </div>
          <div className="mt-1.5"><StatusChip c={c} /></div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 space-y-1">
          <StatBar label="Stealth" value={c.stats.stealth} />
          <StatBar label="Muscle" value={c.stats.muscle} color="bg-danger" />
          <StatBar label="Luck" value={c.stats.luck} color="bg-jackpot" />
          <StatBar label="Rep" value={c.stats.reputation} color="bg-pd" />
        </div>
      )}
    </button>
  );
}
