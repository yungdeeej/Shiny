"use client";

import { withdrawalTax } from "@trash-wars/economy";
import { POLICY, formatShiny, toBaseUnits } from "@trash-wars/shared";
import clsx from "clsx";
import React, { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { TokenAmount } from "../../components/ui/TokenAmount";
import { useGameMutation, useGameQuery, useMe } from "../../lib/hooks";

function ReservesPanel() {
  const { data: por } = useGameQuery(["reserves"], (c) => c.getProofOfReserves(), { refetchInterval: 30_000 });
  if (!por) return <Skeleton className="h-40 w-full" />;
  const reserves = Number(BigInt(por.onchainReserves) / 1_000_000n);
  const liabilities = Number(BigInt(por.liabilities) / 1_000_000n);
  const max = Math.max(reserves, liabilities, 1);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm">Proof of reserves</h3>
        <span className={clsx("rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest", por.healthy ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
          {por.healthy ? "HEALTHY" : "AT RISK"} · {(por.ratioBps / 100).toFixed(0)}%
        </span>
      </div>
      {[
        { label: "On-chain reserves", value: reserves, cls: "bg-success" },
        { label: "Player liabilities", value: liabilities, cls: "bg-pd" },
      ].map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{row.label}</span>
            <span className="tabular-nums text-text">{row.value.toLocaleString("en-US")} ✦</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
            <div className={clsx("h-full rounded-full", row.cls)} style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <p className="text-[10px] text-muted/70">
        hot wallet {formatShiny(por.hotWallet, { compact: true })} ✦ · multisig {formatShiny(por.multisig, { compact: true })} ✦ · snapshot {new Date(por.at).toLocaleTimeString()}
      </p>
    </div>
  );
}

export default function BankPage() {
  const { data: me, isLoading, isError, refetch } = useMe();
  const { data: history } = useGameQuery(["bank-history"], (c) => c.getBankHistory(), { refetchInterval: 8_000 });
  const [amountStr, setAmountStr] = useState("");
  const [dest, setDest] = useState("");

  const faucet = useGameMutation((c) => c.deposit("0"), ["me", "bank-history"], {
    successToast: (r) => `Faucet paid out ${formatShiny(r.amount, { compact: true })} ✦`,
  });
  const withdraw = useGameMutation(
    (c, args: { amount: string; dest: string }) => c.withdraw(args.amount, args.dest),
    ["me", "bank-history"],
    { successToast: (w) => `Withdrawal sent — ${formatShiny(w.net, { compact: true })} ✦ after the rake.`, onSuccess: () => { setAmountStr(""); setDest(""); } },
  );

  const amount = useMemo(() => {
    try {
      return amountStr.trim() === "" ? 0n : toBaseUnits(amountStr.trim());
    } catch {
      return 0n;
    }
  }, [amountStr]);
  const fee = amount > 0n ? withdrawalTax(amount) : 0n;
  const balance = me ? BigInt(me.balance) : 0n;
  const valid = amount >= POLICY.minWithdrawal && amount <= balance && dest.trim().length >= 3;

  if (isError) return <ErrorState message="The vault won't open." retry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">The Bank</h1>
        <p className="text-sm text-muted">In-game custodial balance. Mainnet uses memo deposits — the beta uses a faucet.</p>
      </div>

      {/* balance hero */}
      <div className="card flex flex-col items-center gap-1 bg-gradient-to-b from-surface to-surface2 p-8">
        <span className="noir-label">Your stack</span>
        {isLoading || !me ? (
          <Skeleton className="h-10 w-44" />
        ) : (
          <>
            <TokenAmount amount={me.balance} compact={false} className="font-display text-4xl" glyphSize={28} />
            {BigInt(me.lockedBalance) > 0n && (
              <span className="text-xs text-muted">
                + <TokenAmount amount={me.lockedBalance} className="text-xs" muted /> escrowed on active jobs
              </span>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* deposit / faucet */}
        <div className="card space-y-3 p-4">
          <h3 className="font-display text-sm">Deposit</h3>
          <p className="text-xs text-muted">
            On mainnet you&apos;ll send $SHINY to the vault address with your memo code. In the beta, the city just… gives you money.
          </p>
          <Button className="w-full" loading={faucet.isPending} onClick={() => faucet.mutate(undefined)}>
            Claim 100,000 beta $SHINY
          </Button>
          <p className="text-[10px] text-muted/70">One claim per 24 game hours (24 real minutes).</p>
        </div>

        {/* withdraw */}
        <div className="card space-y-3 p-4">
          <h3 className="font-display text-sm">Withdraw</h3>
          <input
            type="number"
            inputMode="numeric"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder={`amount (min ${formatShiny(POLICY.minWithdrawal)})`}
            className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent/60"
            aria-label="Withdrawal amount"
          />
          <input
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="destination address (beta accepts anything)"
            className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 font-mono text-xs outline-none focus:border-accent/60"
            aria-label="Destination address"
          />
          <div className="rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">
            fee 5% → treasury: <span className="font-bold text-danger">−{formatShiny(fee)} ✦</span>
            <span className="mx-1.5">·</span>
            you receive: <span className="font-bold text-success">{formatShiny(amount - fee)} ✦</span>
          </div>
          {amount > 0n && amount < POLICY.minWithdrawal && (
            <p className="text-xs text-danger">Minimum withdrawal is {formatShiny(POLICY.minWithdrawal)} ✦.</p>
          )}
          {amount > balance && <p className="text-xs text-danger">That&apos;s more than you have.</p>}
          <Button className="w-full" variant="ghost" disabled={!valid} loading={withdraw.isPending} onClick={() => withdraw.mutate({ amount: amount.toString(), dest })}>
            Send it
          </Button>
        </div>
      </div>

      <ReservesPanel />

      {/* history */}
      <div className="space-y-2">
        <h3 className="font-display text-sm">Paper trail</h3>
        {!history ? (
          <Skeleton className="h-24 w-full" />
        ) : history.length === 0 ? (
          <EmptyState line="No paper trail. The way you like it." />
        ) : (
          <div className="card divide-y divide-line">
            {history.slice(0, 12).map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span aria-hidden>{row.kind === "withdraw" ? "📤" : "📥"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{row.note}</div>
                  <div className="text-[10px] text-muted">{new Date(row.at).toLocaleString()}</div>
                </div>
                <TokenAmount amount={row.amount} className={clsx("text-sm", row.kind === "withdraw" && "text-danger")} />
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                    row.state === "sent" || row.state === "credited" ? "bg-success/15 text-success" : row.state === "failed" || row.state === "denied" ? "bg-danger/15 text-danger" : "bg-surface2 text-muted",
                  )}
                >
                  {row.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
