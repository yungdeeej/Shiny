"use client";

import { usePathname, useRouter } from "next/navigation";
import React, { useEffect } from "react";
import { useGameClientSafe } from "../../lib/client/provider";
import { useMe } from "../../lib/hooks";
import { FeedTicker } from "../ui/FeedTicker";
import { ToastHost } from "../ui/Toast";
import { MissionWatcher } from "./MissionWatcher";
import { MobileTabBar } from "./MobileTabBar";
import { TopBar } from "./TopBar";

const BARE_ROUTES = ["/onboarding", "/tos", "/kitchen-sink"];

export function BetaRibbon() {
  return (
    <div className="pointer-events-none fixed right-[-64px] top-[26px] z-[55] rotate-45">
      <div className="bg-accent px-16 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-bg shadow-glow-amber">
        Open Beta · 60× time · play-money
      </div>
    </div>
  );
}

/** Redirects to /onboarding when there is no session. */
function SessionGate() {
  const pathname = usePathname();
  const router = useRouter();
  const client = useGameClientSafe();
  const { isError, isSuccess } = useMe();

  useEffect(() => {
    if (!client) return;
    if (isError && !BARE_ROUTES.some((r) => pathname.startsWith(r))) {
      router.replace("/onboarding");
    }
  }, [client, isError, isSuccess, pathname, router]);

  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((r) => pathname.startsWith(r));

  if (bare) {
    return (
      <>
        <ToastHost />
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SessionGate />
      <BetaRibbon />
      <TopBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-32 pt-4 sm:px-5 md:pb-16">{children}</main>
      {/* feed ticker: bottom on desktop, above the tab bar on mobile */}
      <div className="fixed inset-x-0 bottom-16 z-40 md:bottom-0">
        <FeedTicker />
      </div>
      <MobileTabBar />
      <ToastHost />
      <MissionWatcher />
    </div>
  );
}
