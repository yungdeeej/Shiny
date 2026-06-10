"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { useGameClientSafe } from "../../lib/client/provider";
import { useMe } from "../../lib/hooks";
import { useUiStore } from "../../lib/uiStore";
import { Logo } from "../art/Logo";
import { BalancePill } from "../ui/BalancePill";
import { SeasonTimer } from "../ui/SeasonTimer";

export function TopBar() {
  const { data: me } = useMe();
  const client = useGameClientSafe();
  const qc = useQueryClient();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const soundOn = useUiStore((s) => s.soundOn);
  const toggleSound = useUiStore((s) => s.toggleSound);

  return (
    <header className="glass sticky top-0 z-50 flex h-14 items-center gap-3 border-x-0 border-t-0 px-3 sm:px-5">
      <Link href="/" className="shrink-0" aria-label="City map">
        <Logo className="text-xl" />
      </Link>
      <nav className="ml-2 hidden items-center gap-1 text-sm text-muted lg:flex">
        {[
          ["/", "City"],
          ["/den", "Den"],
          ["/bank", "Bank"],
          ["/precinct", "Precinct"],
          ["/store", "Store"],
          ["/market", "Market"],
          ["/raffles", "Raffles"],
          ["/leaderboard", "Ranks"],
        ].map(([href, label]) => (
          <Link key={href} href={href ?? "/"} className="rounded-lg px-2.5 py-1.5 hover:bg-surface2 hover:text-text">
            {label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2.5">
        <SeasonTimer />
        <BalancePill />
        {me && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted/50"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="max-w-[90px] truncate">{me.handle}</span>
              <span className="text-[9px] text-muted">▼</span>
            </button>
            {menuOpen && (
              <div className="card absolute right-0 top-11 z-50 w-48 p-1.5 text-sm shadow-sheet" role="menu">
                <Link href="/verify" className="block rounded-lg px-3 py-2 hover:bg-surface2" onClick={() => setMenuOpen(false)}>
                  Verify fairness
                </Link>
                <Link href="/transparency" className="block rounded-lg px-3 py-2 hover:bg-surface2" onClick={() => setMenuOpen(false)}>
                  Transparency
                </Link>
                <Link href="/kitchen-sink" className="block rounded-lg px-3 py-2 text-muted hover:bg-surface2" onClick={() => setMenuOpen(false)}>
                  Kitchen sink (QA)
                </Link>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface2"
                  onClick={() => {
                    toggleSound();
                    setMenuOpen(false);
                  }}
                >
                  Sound: {soundOn ? "on" : "off"}
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-danger hover:bg-surface2"
                  onClick={async () => {
                    setMenuOpen(false);
                    await client?.logout();
                    qc.clear();
                    router.push("/onboarding");
                  }}
                >
                  Burn this identity
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
