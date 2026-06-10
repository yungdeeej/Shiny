"use client";

import React from "react";
import { AppShell } from "../components/game/AppShell";
import { GameClientProvider } from "../lib/client/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameClientProvider>
      <AppShell>{children}</AppShell>
    </GameClientProvider>
  );
}
