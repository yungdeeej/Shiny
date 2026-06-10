"use client";

/**
 * The Solana wallet tree: ConnectionProvider + WalletProvider + a custom
 * connect modal in the game's noir style (no wallet-adapter-react-ui).
 *
 * Heavy by design (@solana/web3.js + adapters) — it is ONLY ever loaded via
 * next/dynamic({ ssr: false }) from app/providers.tsx when the app runs
 * against the real API (NEXT_PUBLIC_DEMO_MODE=0). Demo mode never fetches
 * this chunk. Everything else talks to it through lib/walletStore.ts.
 *
 * Phantom + Solflare ship as explicit adapters; wallet-standard wallets
 * (Backpack, etc.) auto-register through the base adapter layer.
 */
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  type Wallet,
} from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSiwsLogin } from "./useSiwsLogin";
import { useWalletUiStore } from "./walletStore";

const ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

/** Registers wallet.disconnect() on the store so TopBar can call it. */
function WalletBridgeSync(): null {
  const { disconnect } = useWallet();
  const setDisconnect = useWalletUiStore((s) => s.setDisconnect);
  useEffect(() => {
    setDisconnect(disconnect);
    return () => setDisconnect(null);
  }, [disconnect, setDisconnect]);
  return null;
}

function WalletRow({ wallet, onPick }: { wallet: Wallet; onPick: (w: Wallet) => void }) {
  const detected =
    wallet.readyState === WalletReadyState.Installed || wallet.readyState === WalletReadyState.Loadable;
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={wallet.adapter.icon} alt="" className="h-7 w-7 rounded-lg" />
      <span className="flex-1 text-left font-semibold">{wallet.adapter.name}</span>
      <span className={`text-[10px] uppercase tracking-wide ${detected ? "text-accent" : "text-muted/60"}`}>
        {detected ? "Detected" : "Install"}
      </span>
    </>
  );
  const cls =
    "flex w-full items-center gap-3 rounded-xl border border-line bg-surface2 px-3.5 py-2.5 text-sm hover:border-accent/60";
  return detected ? (
    <button className={cls} onClick={() => onPick(wallet)}>
      {inner}
    </button>
  ) : (
    <a className={cls} href={wallet.adapter.url} target="_blank" rel="noreferrer">
      {inner}
    </a>
  );
}

/** Connect modal + the connect → sign → verify state machine. */
function WalletConnectModal() {
  const { wallets, wallet, select, connect, connected, publicKey, disconnect } = useWallet();
  const open = useWalletUiStore((s) => s.modalOpen);
  const phase = useWalletUiStore((s) => s.phase);
  const error = useWalletUiStore((s) => s.error);
  const setPhase = useWalletUiStore((s) => s.setPhase);
  const closeModal = useWalletUiStore((s) => s.closeModal);
  const login = useSiwsLogin();

  const [intent, setIntent] = useState<string | null>(null);
  const busyRef = useRef(false);

  const signAndLogin = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("signing");
    try {
      await login();
      setIntent(null);
      const { onSuccess } = useWalletUiStore.getState();
      closeModal();
      onSuccess?.();
    } catch (e) {
      setPhase("error", e instanceof Error ? e.message : "Signature failed.");
    } finally {
      busyRef.current = false;
    }
  }, [login, setPhase, closeModal]);

  // Step 1: a wallet was picked → connect once the adapter is selected.
  useEffect(() => {
    if (!open || phase !== "connecting" || !intent) return;
    if (!wallet || wallet.adapter.name !== intent || connected) return;
    connect().catch((e: unknown) => {
      setIntent(null);
      setPhase("error", e instanceof Error ? e.message : "Couldn't connect to the wallet.");
    });
  }, [open, phase, intent, wallet, connected, connect, setPhase]);

  // Step 2: connected → request the SIWS signature.
  useEffect(() => {
    if (!open || phase !== "connecting" || !intent || !connected || !publicKey) return;
    void signAndLogin();
  }, [open, phase, intent, connected, publicKey, signAndLogin]);

  if (!open) return null;

  const pick = (w: Wallet) => {
    setPhase("connecting");
    setIntent(w.adapter.name);
    if (connected && wallet?.adapter.name === w.adapter.name) {
      void signAndLogin();
    } else {
      select(w.adapter.name);
    }
  };

  const busy = phase === "signing" || phase === "verifying";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a Solana wallet"
      onClick={() => !busy && closeModal()}
    >
      <div className="card w-full max-w-sm space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Connect a wallet</h2>
          <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
            {CLUSTER}
          </span>
        </div>

        {busy ? (
          <div className="space-y-2 py-4 text-center">
            <p className="font-display text-base">Check your wallet</p>
            <p className="text-xs text-muted">Sign the message to prove you own the address. It costs nothing.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {wallets.map((w) => (
              <WalletRow key={w.adapter.name} wallet={w} onPick={pick} />
            ))}
            {wallets.length === 0 && (
              <p className="py-3 text-center text-xs text-muted">
                No Solana wallets detected. Install Phantom, Solflare or Backpack and reload.
              </p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-2">
            <p className="text-center text-xs text-danger">{error}</p>
            {connected && (
              <button
                className="w-full rounded-xl border border-line px-3 py-2 text-xs hover:border-accent/60"
                onClick={() => void signAndLogin()}
              >
                Try signing again
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted/60">
          <span>SIWS — message signature only, no transaction.</span>
          <button
            className="underline hover:text-text"
            onClick={() => {
              void disconnect().catch(() => undefined);
              closeModal();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Mounted (lazily) from app/providers.tsx when NEXT_PUBLIC_DEMO_MODE=0.
 * Children are optional — the modal + store bridge live inside this tree, so
 * the rest of the app never needs wallet context.
 */
export function WalletConnectionProvider({ children }: { children?: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletBridgeSync />
        <WalletConnectModal />
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default WalletConnectionProvider;
