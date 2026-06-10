"use client";

import type { CosmeticItem } from "@trash-wars/shared";
import clsx from "clsx";
import React, { useState } from "react";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/EmptyState";
import { Sheet } from "../../components/ui/Sheet";
import { Skeleton } from "../../components/ui/Skeleton";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { useCharacters, useGameMutation, useGameQuery } from "../../lib/hooks";

const RARITY_BORDER: Record<CosmeticItem["rarity"], string> = {
  common: "border-line",
  rare: "border-pd/50",
  epic: "border-jackpot/60",
  legendary: "border-accent shadow-glow-amber",
};

const SLOT_ORDER: CosmeticItem["slot"][] = ["hat", "mask", "coat", "companion", "banner", "nameplate"];

/** preview dna used to render items on a mannequin raccoon */
const MANNEQUIN_DNA = "f00dfacef00dfacef00dfacef00dface";

export default function StorePage() {
  const { data: items, isLoading, isError, refetch } = useGameQuery(["store"], (c) => c.getStoreItems());
  const { data: inventory } = useGameQuery(["inventory"], (c) => c.getInventory(), { refetchInterval: 6_000 });
  const { data: characters } = useCharacters();
  const [equipping, setEquipping] = useState<string | null>(null);

  const buy = useGameMutation((c, slug: string) => c.buyItem(slug), ["me", "inventory", "store"], {
    successToast: (i) => `${i.name} acquired — the price burned forever.`,
    onSuccess: (i) => setEquipping(i.slug),
  });
  const equip = useGameMutation(
    (c, args: { slug: string; characterId: string | null }) => c.equip(args.slug, args.characterId),
    ["characters", "inventory"],
    { onSuccess: () => setEquipping(null) },
  );

  if (isError) return <ErrorState message="Shutters are down." retry={() => void refetch()} />;

  const owned = new Set(inventory ?? []);
  const equipped = new Set((characters ?? []).flatMap((c) => c.cosmetics));
  const eligibleChars = (characters ?? []).filter((c) => c.status !== "dead" && c.inGame);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">The Fence&apos;s Storefront</h1>
        <p className="text-sm text-muted">Cosmetics only — drip, not stats. $SHINY purchases burn. 🔥</p>
      </div>

      {isLoading || !items ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        SLOT_ORDER.filter((slot) => items.some((i) => i.slot === slot)).map((slot) => (
          <div key={slot} className="space-y-2">
            <div className="noir-label capitalize">{slot}s</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {items
                .filter((i) => i.slot === slot)
                .map((item) => {
                  const isOwned = owned.has(item.slug) || equipped.has(item.slug);
                  const premium = item.priceShiny === null;
                  return (
                    <div key={item.slug} className={clsx("card flex flex-col gap-2 border-2 p-3", RARITY_BORDER[item.rarity])}>
                      <div className="relative mx-auto">
                        <CharacterAvatar dna={MANNEQUIN_DNA} faction="raccoon" cosmetics={[item.slug]} size={110} />
                        <span
                          className={clsx(
                            "absolute -right-1 -top-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                            premium ? "bg-jackpot/20 text-jackpot" : "bg-accent/20 text-accent",
                          )}
                        >
                          {premium ? "PREMIUM" : "BURN"}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{item.name}</div>
                        <div className="text-[10px] uppercase tracking-widest text-muted">{item.rarity}{item.supplyCap !== null && ` · ${item.remaining}/${item.supplyCap} left`}</div>
                        <p className="mt-1 text-xs italic text-muted">{item.description}</p>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        {premium ? (
                          <span className="text-xs text-jackpot">{item.priceSol} SOL</span>
                        ) : (
                          <TokenAmount amount={item.priceShiny ?? "0"} className="text-sm" />
                        )}
                        {isOwned ? (
                          <Button size="sm" variant="ghost" onClick={() => setEquipping(item.slug)}>
                            Equip
                          </Button>
                        ) : (
                          <Button size="sm" disabled={premium || buy.isPending} onClick={() => buy.mutate(item.slug)}>
                            {premium ? "with mainnet" : "Buy 🔥"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))
      )}

      {/* equip sheet */}
      <Sheet open={equipping !== null} onClose={() => setEquipping(null)} title="Who wears it?">
        {equipping && (
          <div className="space-y-2">
            {eligibleChars.length === 0 && <p className="text-sm text-muted">Nobody alive to dress up.</p>}
            {eligibleChars.map((c) => (
              <button
                key={c.id}
                className="card flex w-full items-center gap-3 p-3 text-left hover:border-accent/50"
                onClick={() => equip.mutate({ slug: equipping, characterId: c.id })}
              >
                <CharacterAvatar dna={c.dna} faction={c.faction} cosmetics={[...c.cosmetics, equipping]} size={56} />
                <span className="flex-1 text-sm font-semibold">{c.name}</span>
                <span className="text-xs text-accent">preview →</span>
              </button>
            ))}
            {equipped.has(equipping) && (
              <Button variant="danger" className="w-full" onClick={() => equip.mutate({ slug: equipping, characterId: null })}>
                Unequip
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
