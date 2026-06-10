"use client";

import { POLICY, formatShiny, toBaseUnits } from "@trash-wars/shared";
import React, { useMemo, useState } from "react";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Button } from "../../components/ui/Button";
import { CharacterCard } from "../../components/ui/CharacterCard";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Sheet } from "../../components/ui/Sheet";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatBar } from "../../components/ui/StatBar";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { priceHistory } from "../../lib/client/local/bots";
import { useCharacters, useGameMutation, useGameQuery, useMe } from "../../lib/hooks";
import { useUiStore } from "../../lib/uiStore";

function Sparkline({ seed }: { seed: string }) {
  const points = useMemo(() => priceHistory(seed, 16), [seed]);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (points.length - 1)) * 80} ${24 - ((p - min) / Math.max(1, max - min)) * 22}`)
    .join(" ");
  const up = (points[points.length - 1] ?? 0) >= (points[0] ?? 0);
  return (
    <svg width="80" height="26" aria-label="price history" className="opacity-80">
      <path d={path} fill="none" stroke={up ? "#3DDC97" : "#FF4D5E"} strokeWidth="1.6" />
    </svg>
  );
}

export default function MarketPage() {
  const { data: listings, isLoading, isError, refetch } = useGameQuery(["listings"], (c) => c.getListings(), { refetchInterval: 8_000 });
  const { data: me } = useMe();
  const { data: characters } = useCharacters();
  const toast = useUiStore((s) => s.toast);
  const [listOpen, setListOpen] = useState(false);
  const [listCharId, setListCharId] = useState<string | null>(null);
  const [priceStr, setPriceStr] = useState("");

  const buy = useGameMutation((c, id: string) => c.buyListing(id), ["listings", "me", "characters"], {
    successToast: (l) => `${l.character?.name ?? "Recruit"} joins your den.`,
  });
  const createListing = useGameMutation(
    (c, args: { refId: string; price: string }) => c.list(args.refId, args.price),
    ["listings", "characters"],
    { onSuccess: () => { setListOpen(false); setListCharId(null); setPriceStr(""); toast("Listed. Bots with taste may bite.", "success"); } },
  );
  const delist = useGameMutation((c, id: string) => c.delist(id), ["listings", "characters"], {
    successToast: () => "Pulled off the shelf.",
  });

  const myHandle = me?.handle;
  const listableChars = (characters ?? []).filter((c) => c.status === "idle" && c.inGame);
  const price = useMemo(() => {
    try {
      return priceStr.trim() === "" ? 0n : toBaseUnits(priceStr.trim());
    } catch {
      return 0n;
    }
  }, [priceStr]);

  if (isError) return <ErrorState message="The market square flooded." retry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl">Night Market</h1>
          <p className="text-sm text-muted">
            Characters change hands here. {POLICY.marketplaceFeeBps / 100}% fee — half burns, half to the treasury (seller nets 90%).
          </p>
        </div>
        <Button variant="ghost" onClick={() => setListOpen(true)} disabled={listableChars.length === 0}>
          + List one of yours
        </Button>
      </div>

      {isLoading || !listings ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <EmptyState line="Shelves are bare. Somebody clean this place out already?" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => {
            const mine = l.sellerHandle === myHandle;
            const c = l.character;
            const fee = (BigInt(l.price) * BigInt(POLICY.marketplaceFeeBps)) / 10_000n;
            return (
              <div key={l.id} className="card flex flex-col gap-3 p-4">
                {c && (
                  <div className="flex items-center gap-3">
                    <CharacterAvatar dna={c.dna} faction={c.faction} cosmetics={c.cosmetics} size={64} />
                    <div className="min-w-0">
                      <div className="truncate font-display text-sm">{c.name}</div>
                      <div className="text-xs text-muted">Lv {c.level} · sold by {mine ? "you" : l.sellerHandle}</div>
                    </div>
                    <div className="ml-auto"><Sparkline seed={l.id} /></div>
                  </div>
                )}
                {c && (
                  <div className="space-y-1">
                    <StatBar label="Stealth" value={c.stats.stealth} />
                    <StatBar label="Muscle" value={c.stats.muscle} color="bg-danger" />
                    <StatBar label="Luck" value={c.stats.luck} color="bg-jackpot" />
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                  <div>
                    <TokenAmount amount={l.price} className="text-base" />
                    {!mine && <div className="text-[10px] text-muted">fee inside: {formatShiny(fee, { compact: true })} ✦ (5% 🔥 / 5% 🏛)</div>}
                  </div>
                  {mine ? (
                    <Button size="sm" variant="danger" loading={delist.isPending} onClick={() => delist.mutate(l.id)}>
                      Delist
                    </Button>
                  ) : (
                    <Button size="sm" loading={buy.isPending} onClick={() => buy.mutate(l.id)}>
                      Buy
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* list-your-own */}
      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="List a crew member">
        <div className="space-y-3">
          {listableChars.length === 0 && <p className="text-sm text-muted">Only idle characters can be listed.</p>}
          {listableChars.map((c) => (
            <CharacterCard key={c.id} character={c} compact selected={listCharId === c.id} onClick={() => setListCharId(c.id)} />
          ))}
          <input
            type="number"
            inputMode="numeric"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            placeholder="asking price in $SHINY"
            className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent/60"
          />
          {price > 0n && (
            <p className="text-xs text-muted">
              You&apos;d net <span className="font-bold text-success">{formatShiny(price - (price * BigInt(POLICY.marketplaceFeeBps)) / 10_000n)} ✦</span> after the 10% fee.
            </p>
          )}
          <Button
            className="w-full"
            disabled={!listCharId || price <= 0n}
            loading={createListing.isPending}
            onClick={() => listCharId && createListing.mutate({ refId: listCharId, price: price.toString() })}
          >
            List it
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
