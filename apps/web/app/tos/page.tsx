import Link from "next/link";
import React from "react";
import { Logo } from "../../components/art/Logo";

export const metadata = { title: "Beta Terms — Trash Wars" };

export default function TosPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Logo className="text-3xl" />
      <h1 className="mt-6 font-display text-2xl">Open Beta Terms</h1>
      <p className="mt-1 text-xs text-muted">Version 2026-06-beta-1</p>
      <ol className="mt-6 list-decimal space-y-4 pl-5 text-sm text-muted">
        <li>
          <span className="text-text">Play-money only.</span> Beta $SHINY has no monetary value, cannot be purchased,
          and cannot be redeemed for anything. Deposits are a faucet; withdrawals are simulated.
        </li>
        <li>
          <span className="text-text">Time runs 60×.</span> One real minute equals one game hour. Jobs, jail terms,
          patrol shifts and cooldowns are all accelerated.
        </li>
        <li>
          <span className="text-text">Progress may be reset</span> at any time, for any reason, including the end of the
          beta. Your save lives in your own browser.
        </li>
        <li>
          <span className="text-text">Provably fair.</span> Mission outcomes derive from a server seed committed (hashed)
          before you stake. You can verify every roll on the Verify page.
        </li>
        <li>
          <span className="text-text">Fictional crime only.</span> Shorefront City, its raccoons, bloodhounds and
          institutions are fiction. Don&apos;t rob actual bodegas.
        </li>
        <li>
          <span className="text-text">No warranty.</span> The beta is provided as-is; expect rough edges, rebalances and
          the occasional dead raccoon.
        </li>
      </ol>
      <Link href="/onboarding" className="mt-8 inline-block text-sm text-accent underline">
        ← Back to onboarding
      </Link>
    </div>
  );
}
