import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Trash Wars — Admin",
  description: "Operational controls for Shorefront City (placeholder).",
};

export const viewport: Viewport = { themeColor: "#0b0e13" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0b0e13",
          color: "#d7dce3",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
