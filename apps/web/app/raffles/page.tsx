"use client";

import { formatShiny, type Raffle } from "@trash-wars/shared";
import clsx from "clsx";
import React, { useState } from "react";
import { Button } from "../../components/ui/Button";
import { CountdownPill } from "../../components/ui/CountdownPill";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { LOCAL_POLICY } from "../../lib/client/local/content";
import { useGameMutation, useGameQuery } from "../../lib/hooks";

function RaffleCard({ raffle }: { raffle: Raffle }) {
  const [count, setCount] = useState(1);
  const buy = useGameMutation(
    (c, args: { id: string; count: number }) => c.buyTickets(args.id, args.count),
    ["raffles", "me"],
    { successToast: () => `Tickets in the drum. The price burned.` },
  );
  const open = raffle.state === "open";
  const total = BigInt(raffle.ticketPrice) * BigInt(count);
  return (
    <div className={clsx("card space-y-3 p-4", raffle.state === "drawn" && "opacity-80")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display">{raffle.title}</div>
          <div className="text-xs capitalize text-muted">{raffle.type} raffle · prize: {raffle.type === "recruitment" ? "a fresh raccoon" : String(raffle.prize.cosmeticSlug ?? "cosmetic")}</div>
        </div>
        {open ? <CountdownPill until={raffle.drawsAt} prefix="draws " /> : (
          <span className="rounded-full bg-jackpot/15 px-2.5 py-1 text-[10px] font-bold text-jackpot">DRAWN</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="rounded-full bg-surface2 px-2.5 py-1">{raffle.ticketsSold} tickets sold</span>
        <span className="rounded-full bg-surface2 px-2.5 py-1 text-accent">{raffle.myTickets ?? 0} yours</span>
        <span className="rounded-full bg-surface2 px-2.5 py-1">
          <TokenAmount amount={raffle.ticketPrice} className="text-xs" /> / ticket 🔥
        </span>
      </div>
      {open ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-line bg-surface2">
            <button className="px-3 py-2 text-muted hover:text-text" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="fewer">−</button>
            <span className="w-8 text-center text-sm font-bold tabular-nums">{count}</span>
            <button className="px-3 py-2 text-muted hover:text-text" onClick={() => setCount((c) => Math.min(50, c + 1))} aria-label="more">+</button>
          </div>
          <Button className="flex-1" loading={buy.isPending} onClick={() => buy.mutate({ id: raffle.id, count })}>
            Burn {formatShiny(total, { compact: true })} ✦ for {count} ticket{count > 1 ? "s" : ""}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl bg-surface2 px-3 py-2 text-sm">
          Winner: <span className="font-bold text-accent">{raffle.winners?.[0] ?? "?"}</span>
          <a href={`/verify`} className="ml-2 text-xs text-pd underline">Verify</a>
        </div>
      )}
      <p className="break-all font-mono text-[9px] text-muted/50">commit {raffle.serverSeedHash.slice(0, 32)}…</p>
    </div>
  );
}

export default function RafflesPage() {
  const { data: raffles, isLoading, isError, refetch } = useGameQuery(["raffles"], (c) => c.getRaffles(), { refetchInterval: 4_000 });
  const { data: me } = useGameQuery(["me"], (c) => c.getMe());
  void me;

  if (isError) return <ErrorState message="The drum fell off the table." retry={() => void refetch()} />;

  const live = (raffles ?? []).filter((r) => r.state === "open" || r.state === "drawing");
  const past = (raffles ?? []).filter((r) => r.state === "drawn");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">Back-Alley Raffles</h1>
        <p className="text-sm text-muted">Tickets burn $SHINY. Draws are seeded and committed up front — same math as missions.</p>
      </div>

      {/* login fragment meter */}
      <div className="card flex items-center gap-3 p-4">
        <span className="text-2xl" aria-hidden>🧩</span>
        <div className="flex-1">
          <div className="text-sm font-semibold">Login fragments</div>
          <div className="text-xs text-muted">{LOCAL_POLICY.loginFragmentsPerTicket} fragments = 1 free ticket, auto-entered into the live recruitment raffle.</div>
        </div>
        <div className="flex gap-1">
          {Array.from({ length: LOCAL_POLICY.loginFragmentsPerTicket }).map((_, i) => (
            <span key={i} className={clsx("h-3 w-3 rounded-sm", i < 1 ? "bg-accent" : "bg-surface2 border border-line")} />
          ))}
        </div>
      </div>

      {isLoading || !raffles ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {live.map((r) => (
              <RaffleCard key={r.id} raffle={r} />
            ))}
          </div>
          {live.length === 0 && <EmptyState line="No drums spinning tonight." hint="New raffles open with each mint wave." />}
          {past.length > 0 && (
            <div className="space-y-2">
              <div className="noir-label">Past draws</div>
              <div className="grid gap-3 md:grid-cols-2">
                {past.map((r) => (
                  <RaffleCard key={r.id} raffle={r} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
