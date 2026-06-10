"use client";

import { SEASON1_LOCATIONS, idleRatePerHour } from "@trash-wars/economy";
import { POLICY, formatShiny, type Character, type StatKey } from "@trash-wars/shared";
import clsx from "clsx";
import React, { useMemo, useState } from "react";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Button } from "../../components/ui/Button";
import { CharacterCard } from "../../components/ui/CharacterCard";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Sheet } from "../../components/ui/Sheet";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatBar } from "../../components/ui/StatBar";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { upgradeCostFor } from "../../lib/client/local/engine";
import { useCharacters, useGameMutation, useGameQuery, useNow } from "../../lib/hooks";
import { realMsToGameHours } from "../../lib/time";

const STAT_KEYS: Array<{ key: StatKey; label: string; color: string; blurb: string }> = [
  { key: "stealth", label: "Stealth", color: "bg-accent", blurb: "−1.5% arrest odds / lvl" },
  { key: "muscle", label: "Muscle", color: "bg-danger", blurb: "+2% payout / lvl (cap +20%)" },
  { key: "luck", label: "Luck", color: "bg-jackpot", blurb: "+0.3% jackpot / lvl" },
  { key: "reputation", label: "Rep", color: "bg-pd", blurb: "patrol weight & PD yield" },
];

function MintBanners() {
  const { data: events } = useGameQuery(["mints"], (c) => c.getMintEvents(), { refetchInterval: 10_000 });
  const [revealed, setRevealed] = useState<Character | null>(null);
  const mint = useGameMutation((c, id: string) => c.mint(id), ["characters", "me", "mints"], {
    onSuccess: (ch) => setRevealed(ch),
  });
  if (!events) return null;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {events.map((e) => (
          <div
            key={e.id}
            className={clsx(
              "card flex items-center gap-4 p-4",
              e.faction === "bloodhound" ? "border-pd/40" : "border-accent/40",
            )}
          >
            <span className="text-3xl" aria-hidden>{e.faction === "bloodhound" ? "🐕" : "🦝"}</span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm capitalize">{e.faction} mint wave</div>
              <div className="text-xs text-muted">
                {e.remaining}/{e.supply} left · Minting burns{" "}
                <span className="font-bold text-accent">{formatShiny(e.price, { compact: true })} $SHINY</span>. Forever. 🔥
              </div>
              {e.faction === "bloodhound" && (
                <div className="text-[10px] text-pd">Force capped at 10% of living characters.</div>
              )}
            </div>
            <Button
              size="sm"
              variant={e.faction === "bloodhound" ? "pd" : "primary"}
              disabled={e.state !== "open"}
              loading={mint.isPending}
              onClick={() => mint.mutate(e.id)}
            >
              {e.state === "open" ? "Mint" : "Sold out"}
            </Button>
          </div>
        ))}
      </div>
      <Sheet open={revealed !== null} onClose={() => setRevealed(null)} title="The crate creaks open…">
        {revealed && (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto w-fit animate-pulse-soft">
              <CharacterAvatar dna={revealed.dna} faction={revealed.faction} size={180} />
            </div>
            <h3 className="font-display text-2xl">{revealed.name}</h3>
            <p className="text-sm text-muted">Fresh off the boat. Stats 1 across the board — training burns $SHINY.</p>
            <Button onClick={() => setRevealed(null)}>Welcome to the crew</Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

function DetailDrawer({ character: c, onClose }: { character: Character | null; onClose: () => void }) {
  const now = useNow(1_000);
  const [renaming, setRenaming] = useState("");
  const station = useGameMutation((cl, args: { id: string; slug: string | null }) => cl.station(args.id, args.slug), ["characters", "me"]);
  const claim = useGameMutation((cl, id: string) => cl.claimIdle(id), ["characters", "me"], {
    successToast: (r) => `Tip jar emptied: +${formatShiny(r.amount, { compact: true })} ✦`,
  });
  const upgrade = useGameMutation((cl, args: { id: string; stat: StatKey }) => cl.upgrade(args.id, args.stat), ["characters", "me"]);
  const rename = useGameMutation((cl, args: { id: string; name: string }) => cl.rename(args.id, args.name), ["characters", "me"], {
    onSuccess: () => setRenaming(""),
  });

  const accrued = useMemo(() => {
    if (!c?.stationedAt || !c.lastClaimedAt) return null;
    const loc = SEASON1_LOCATIONS.find((l) => l.slug === c.stationedAt);
    if (!loc) return null;
    const hours = Math.min(realMsToGameHours(now - Date.parse(c.lastClaimedAt)), POLICY.idleClaimCapHours);
    return (idleRatePerHour(loc, c.level) * BigInt(Math.floor(hours * 1000))) / 1000n;
  }, [c, now]);

  if (!c) return null;
  const idle = c.status === "idle";
  return (
    <Sheet open onClose={onClose} title={c.name} wide>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <CharacterAvatar dna={c.dna} faction={c.faction} cosmetics={c.cosmetics} size={110} dead={c.status === "dead"} />
          <div className="min-w-0 text-sm">
            <div className="font-display text-lg">{c.name}</div>
            <div className="capitalize text-muted">{c.faction} · Level {c.level} · {c.status.replace("_", " ")}</div>
            {c.cosmetics.length > 0 && (
              <div className="mt-1 text-xs text-muted">wearing: {c.cosmetics.join(", ")}</div>
            )}
          </div>
        </div>

        {/* stats + upgrades */}
        <div className="space-y-2.5">
          <div className="noir-label">Training — 🔥 burns forever</div>
          {STAT_KEYS.map((s) => {
            const v = c.stats[s.key];
            const capped = v >= POLICY.statLevelCapS1;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div className="flex-1">
                  <StatBar label={s.label} value={v} color={s.color} />
                  <div className="pl-[5.5rem] text-[10px] text-muted/70">{s.blurb}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={capped || c.status === "dead" || upgrade.isPending}
                  onClick={() => upgrade.mutate({ id: c.id, stat: s.key })}
                  className="w-28 shrink-0"
                >
                  {capped ? "capped" : <>🔥 <TokenAmount amount={upgradeCostFor(v)} className="text-xs" /></>}
                </Button>
              </div>
            );
          })}
        </div>

        {/* stationing */}
        {c.faction !== "bloodhound" && c.status !== "dead" && (
          <div className="space-y-2">
            <div className="noir-label">Station for idle $SHINY</div>
            {accrued !== null && (
              <div className="card flex items-center justify-between border-success/40 p-3">
                <span className="text-sm">
                  Accruing at {SEASON1_LOCATIONS.find((l) => l.slug === c.stationedAt)?.name} —{" "}
                  <TokenAmount amount={accrued} className="text-sm" />
                  <span className="text-xs text-muted"> (caps at 24 game h)</span>
                </span>
                <Button size="sm" variant="primary" disabled={accrued <= 0n || claim.isPending} onClick={() => claim.mutate(c.id)}>
                  Claim
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {SEASON1_LOCATIONS.map((l) => (
                <button
                  key={l.slug}
                  disabled={!idle || station.isPending}
                  onClick={() => station.mutate({ id: c.id, slug: l.slug })}
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-left text-xs",
                    c.stationedAt === l.slug ? "border-success/60 bg-success/10" : "border-line bg-surface2 hover:border-muted/50",
                    !idle && "opacity-50",
                  )}
                >
                  <span className="block font-semibold">{l.name}</span>
                  <span className="text-muted">{formatShiny(idleRatePerHour(l, c.level), { compact: true })} ✦/game-h</span>
                </button>
              ))}
              {c.stationedAt && (
                <button
                  disabled={!idle || station.isPending}
                  onClick={() => station.mutate({ id: c.id, slug: null })}
                  className="rounded-lg border border-line bg-surface2 px-3 py-2 text-left text-xs text-muted hover:border-danger/50"
                >
                  Unstation (auto-claims)
                </button>
              )}
            </div>
          </div>
        )}

        {/* rename */}
        <div className="space-y-2 border-t border-line pt-4">
          <div className="noir-label">New alias — <TokenAmount amount={250_000_000n} className="text-xs" /> burns</div>
          <div className="flex gap-2">
            <input
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              placeholder={c.name}
              maxLength={24}
              className="flex-1 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent/60"
            />
            <Button
              variant="ghost"
              disabled={renaming.trim().length < 2 || rename.isPending}
              onClick={() => rename.mutate({ id: c.id, name: renaming })}
            >
              Rename
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export default function DenPage() {
  const { data: characters, isLoading, isError, refetch } = useCharacters();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = characters?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">The Den</h1>
        <p className="text-sm text-muted">Your crew. Your liability. Your family. Starter raccoon came free — everything after burns $SHINY.</p>
      </div>

      <MintBanners />

      {isError ? (
        <ErrorState message="The den door is stuck." retry={() => void refetch()} />
      ) : isLoading || !characters ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : characters.length === 0 ? (
        <EmptyState line="An empty den. Even the rats moved somewhere nicer." hint="Mint a recruit above or win one in the raffles." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <CharacterCard key={c.id} character={c} onClick={() => setSelectedId(c.id)} selected={c.id === selectedId} />
          ))}
        </div>
      )}

      <DetailDrawer character={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
