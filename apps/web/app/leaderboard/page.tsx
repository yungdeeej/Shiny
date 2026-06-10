"use client";

import clsx from "clsx";
import React, { useState } from "react";
import { ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { TokenAmount } from "../../components/ui/TokenAmount";
import type { LeaderboardBoard } from "../../lib/client/types";
import { useGameQuery, useMe } from "../../lib/hooks";

const BOARDS: Array<{ key: LeaderboardBoard; label: string; blurb: string }> = [
  { key: "earners", label: "Earners", blurb: "Net heist profit this season" },
  { key: "hounds", label: "Top Hounds", blurb: "PD bounties collected" },
  { key: "heists", label: "Biggest Heists", blurb: "Largest single payout" },
  { key: "most_wanted", label: "Most Wanted", blurb: "Most confiscated by the PD" },
];

const PODIUM = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [board, setBoard] = useState<LeaderboardBoard>("earners");
  const { data: me } = useMe();
  const { data: entries, isLoading, isError, refetch } = useGameQuery(
    ["leaderboard", board],
    (c) => c.getLeaderboard(board),
    { refetchInterval: 15_000 },
  );

  const meta = BOARDS.find((b) => b.key === board);
  const myRow = entries?.find((e) => e.handle === me?.handle);
  const visible = entries?.slice(0, 20) ?? [];
  const myRowOffscreen = myRow && myRow.rank > 20;

  if (isError) return <ErrorState message="The bookie lost his ledger." retry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">The Rankings</h1>
        <p className="text-sm text-muted">{meta?.blurb}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {BOARDS.map((b) => (
          <button
            key={b.key}
            onClick={() => setBoard(b.key)}
            className={clsx(
              "rounded-xl border px-3.5 py-2 text-sm font-semibold",
              board === b.key ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface2 text-muted hover:text-text",
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      {isLoading || !entries ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* podium */}
          <div className="grid grid-cols-3 gap-2">
            {[1, 0, 2].map((podiumIdx) => {
              const e = visible[podiumIdx];
              if (!e) return <div key={podiumIdx} />;
              const isMe = e.handle === me?.handle;
              return (
                <div
                  key={e.rank}
                  className={clsx(
                    "card flex flex-col items-center gap-1 p-4 text-center",
                    podiumIdx === 0 ? "border-accent/60 shadow-glow-amber md:-translate-y-2" : "",
                    isMe && "ring-1 ring-accent",
                  )}
                >
                  <span className="text-2xl">{PODIUM[podiumIdx]}</span>
                  <span className="w-full truncate font-display text-sm">{e.handle}{isMe && " (you)"}</span>
                  <TokenAmount amount={e.value} className="text-sm" />
                  {e.faction && <span className="text-[10px] capitalize text-muted">{e.faction}</span>}
                </div>
              );
            })}
          </div>

          {/* table */}
          <div className="card divide-y divide-line">
            {visible.slice(3).map((e) => {
              const isMe = e.handle === me?.handle;
              return (
                <div key={`${e.rank}-${e.handle}`} className={clsx("flex items-center gap-3 px-4 py-2.5 text-sm", isMe && "bg-accent/10")}>
                  <span className="w-8 font-display text-muted">#{e.rank}</span>
                  <span className={clsx("flex-1 truncate", isMe && "font-bold text-accent")}>
                    {e.handle}
                    {isMe && " (you)"}
                  </span>
                  {e.faction && <span className="hidden text-[10px] capitalize text-muted sm:block">{e.faction}</span>}
                  <TokenAmount amount={e.value} className="text-sm" />
                </div>
              );
            })}
          </div>

          {/* pinned own row when off-screen */}
          {myRowOffscreen && myRow && (
            <div className="sticky bottom-24 md:bottom-12">
              <div className="card flex items-center gap-3 border-accent bg-surface px-4 py-2.5 text-sm shadow-glow-amber">
                <span className="w-8 font-display text-accent">#{myRow.rank}</span>
                <span className="flex-1 truncate font-bold text-accent">{myRow.handle} (you)</span>
                <TokenAmount amount={myRow.value} className="text-sm" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
