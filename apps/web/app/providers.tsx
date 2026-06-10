"use client";

import dynamic from "next/dynamic";
import React from "react";
import { AppShell } from "../components/game/AppShell";
import { GameClientProvider } from "../lib/client/provider";

// Heavy Solana wallet tree (web3.js + adapters) — code-split and only ever
// mounted against the real API. Demo mode never downloads this chunk.
const WalletConnectionProvider = dynamic(
  () => import("../lib/wallet").then((m) => m.WalletConnectionProvider),
  { ssr: false },
);

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameClientProvider>
      {!DEMO && <WalletConnectionProvider />}
      <AppShell>{children}</AppShell>
    </GameClientProvider>
  );
}
