"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState } from "react";
import { Sheet } from "../ui/Sheet";

const TABS = [
  { href: "/", label: "City", icon: "🌃" },
  { href: "/den", label: "Den", icon: "🦝" },
  { href: "/bank", label: "Bank", icon: "🏦" },
  { href: "/store", label: "Store", icon: "🧢" },
] as const;

const MORE = [
  { href: "/precinct", label: "Precinct", icon: "🐕", hint: "Bloodhound HQ & patrols" },
  { href: "/jail", label: "Jail", icon: "🚔", hint: "Bail out your crew" },
  { href: "/raffles", label: "Raffles", icon: "🎟️", hint: "Burn tickets, win recruits" },
  { href: "/market", label: "Market", icon: "🏷️", hint: "Buy & sell characters" },
  { href: "/leaderboard", label: "Leaderboard", icon: "🏆", hint: "Earners, hounds, heists" },
  { href: "/transparency", label: "Transparency", icon: "📊", hint: "Burns, emissions, reserves" },
  { href: "/verify", label: "Verify", icon: "🔍", hint: "Provably-fair checker" },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      <nav className="glass fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold",
              pathname === t.href ? "text-accent" : "text-muted",
            )}
          >
            <span className="text-lg" aria-hidden>{t.icon}</span>
            {t.label}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={clsx("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-muted")}
        >
          <span className="text-lg" aria-hidden>☰</span>
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More of the city">
        <div className="space-y-1.5">
          {MORE.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface2 px-4 py-3 hover:border-accent/50"
            >
              <span className="text-xl" aria-hidden>{m.icon}</span>
              <span>
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  );
}
