import type { Metadata, Viewport } from "next";
import React from "react";
import { GrainOverlay } from "../components/art/GrainOverlay";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Trash Wars — Shorefront City",
  description: "The shiniest token on Solana. Steal it. A noir crypto heist idle game.",
};

export const viewport: Viewport = {
  themeColor: "#0B0E14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GrainOverlay />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
