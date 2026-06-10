"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { CharacterAvatar } from "../../components/art/CharacterAvatar";
import { Logo } from "../../components/art/Logo";
import { Button } from "../../components/ui/Button";
import { useGameClientSafe } from "../../lib/client/provider";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "../../lib/uiStore";
import { useWalletUiStore } from "../../lib/walletStore";
import { sha256Hex } from "@trash-wars/economy";

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "0";

export default function OnboardingPage() {
  const client = useGameClientSafe();
  const qc = useQueryClient();
  const router = useRouter();
  const setGuided = useUiStore((s) => s.setGuided);
  const openWalletModal = useWalletUiStore((s) => s.openModal);
  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("");
  const [tos, setTos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleValid = /^[a-zA-Z0-9_]{3,20}$/.test(handle);

  const login = async (guided: boolean) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await client.guestLogin(handle);
      await qc.invalidateQueries();
      setGuided(guided);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get you a name.");
      setBusy(false);
    }
  };

  // SIWS path (real API only): connect modal → sign → session cookie → city.
  const connectWallet = () => {
    openWalletModal(() => {
      void qc.invalidateQueries();
      setGuided(false);
      router.push("/");
    });
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4">
      {/* ambient skyline strip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 opacity-50" aria-hidden>
        <svg viewBox="0 0 1200 200" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <g fill="#10172a">
            <rect x="0" y="80" width="90" height="120" /><rect x="110" y="40" width="70" height="160" />
            <rect x="200" y="100" width="120" height="100" /><rect x="340" y="60" width="80" height="140" />
            <rect x="440" y="110" width="100" height="90" /><rect x="560" y="30" width="60" height="170" />
            <rect x="640" y="90" width="110" height="110" /><rect x="770" y="50" width="90" height="150" />
            <rect x="880" y="100" width="120" height="100" /><rect x="1020" y="70" width="80" height="130" />
            <rect x="1120" y="110" width="80" height="90" />
          </g>
        </svg>
      </div>

      <motion.div
        key={step}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md text-center"
      >
        {step === 0 && (
          <div className="space-y-6">
            <Logo className="justify-center text-5xl" />
            <p className="font-display text-lg text-muted">
              Shorefront City. The shiniest token on Solana.<br />
              <span className="text-accent">Steal it.</span>
            </p>
            <div className="mx-auto flex w-fit gap-3">
              {["a1b2", "c3d4", "e5f6"].map((s, i) => (
                <CharacterAvatar key={s} dna={sha256Hex(`intro:${s}`)} faction={i === 2 ? "bloodhound" : "raccoon"} size={72} />
              ))}
            </div>
            <p className="text-sm text-muted">
              Stake $SHINY on heists. Odds are committed before you bet. Cops are players too — and they eat what you lose.
            </p>
            <Button size="lg" className="w-full" onClick={() => setStep(1)}>
              Enter the city
            </Button>
            <p className="text-[10px] text-muted/60">OPEN BETA — time runs 60×, balances are play-money.</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5 text-left">
            <h2 className="text-center font-display text-2xl">{DEMO ? "Pick an alias" : "Make your entrance"}</h2>
            <p className="text-center text-sm text-muted">
              {DEMO
                ? "No wallets in the beta. Just a name the city will whisper."
                : "Bring a Solana wallet — or just a name the city will whisper."}
            </p>
            {!DEMO && (
              <div className="space-y-2">
                <Button size="lg" className="w-full" disabled={busy} onClick={connectWallet}>
                  Connect wallet
                  <span className="ml-2 rounded-full border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide opacity-80">
                    devnet
                  </span>
                </Button>
                <p className="text-center text-[10px] text-muted/70">
                  Phantom, Solflare or Backpack. One free signature — your alias is generated from your address.
                  Connecting accepts the <Link href="/tos" className="underline">beta terms</Link>.
                </p>
                <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wide text-muted/60" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  or play as guest — beta only
                  <span className="h-px flex-1 bg-line" />
                </div>
              </div>
            )}
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. Velvet_Knuckles"
              maxLength={20}
              autoFocus
              className="w-full rounded-xl border border-line bg-surface2 px-4 py-3 text-center font-display text-lg outline-none focus:border-accent/60"
            />
            {handle.length > 0 && !handleValid && (
              <p className="text-center text-xs text-danger">3–20 letters, numbers or underscores.</p>
            )}
            <label className="flex items-start gap-2.5 text-xs text-muted">
              <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#FFB627]" />
              <span>
                I accept the <Link href="/tos" className="text-accent underline">beta terms</Link> — play-money, resets possible, raccoons may be harmed.
              </span>
            </label>
            <div className="card flex items-center gap-3 p-3 text-xs text-muted">
              <span className="text-xl" aria-hidden>🦝</span>
              You start as a <span className="font-bold text-accent">Raccoon</span> with 100,000 ✦ and one scruffy recruit.
              The <span className="font-bold text-pd">Bloodhound</span> badge can be minted later.
            </div>
            {error && <p className="text-center text-xs text-danger">{error}</p>}
            <Button size="lg" className="w-full" disabled={!handleValid || !tos || !client} loading={busy} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="font-display text-2xl">First job&apos;s a freebie walkthrough</h2>
            <div className="card space-y-3 p-4 text-left text-sm text-muted">
              <p>① We&apos;ll open the <span className="text-text">Corner Store</span> — training wheels for trash pandas.</p>
              <p>② Pick a stake, read the live odds table, and confirm.</p>
              <p>③ A 2-hour job takes <span className="text-accent">2 real minutes</span> in the beta. While it runs, scope the Den and the Bank.</p>
            </div>
            <Button size="lg" className="w-full" loading={busy} onClick={() => void login(true)}>
              Run the guided job
            </Button>
            <button className="text-xs text-muted underline hover:text-text" disabled={busy} onClick={() => void login(false)}>
              Skip — I&apos;ve robbed places before
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
