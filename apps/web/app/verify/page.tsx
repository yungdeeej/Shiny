"use client";

import { PROVABLY_FAIR_ALGORITHM, SEASON1_LOCATIONS, commitHash, rollFromSeeds } from "@trash-wars/economy";
import type { MissionVerify } from "@trash-wars/shared";
import clsx from "clsx";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { ProbabilityTable } from "../../components/ui/ProbabilityTable";
import { Skeleton } from "../../components/ui/Skeleton";
import { useGameClientSafe } from "../../lib/client/provider";
import { useGameQuery, useMissions } from "../../lib/hooks";

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="noir-label flex items-center gap-2">
        {label}
        {ok !== undefined && (
          <span className={clsx("font-bold", ok ? "text-success" : "text-danger")}>{ok ? "✓ match" : "✗ MISMATCH"}</span>
        )}
      </div>
      <div className="break-all rounded-lg bg-surface2 px-3 py-2 font-mono text-[11px] text-text">{value}</div>
    </div>
  );
}

function VerifyInner() {
  const params = useSearchParams();
  const preselect = params.get("mission");
  const client = useGameClientSafe();
  const { data: missions } = useMissions();
  const [missionId, setMissionId] = useState<string | null>(null);
  const [verify, setVerify] = useState<MissionVerify | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolved = missions?.resolved ?? [];
  const effectiveId = missionId ?? preselect ?? resolved[0]?.id ?? null;

  useEffect(() => {
    if (!client || !effectiveId) return;
    let cancelled = false;
    setError(null);
    client
      .verifyMission(effectiveId)
      .then((v) => {
        if (!cancelled) setVerify(v);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "verification failed");
      });
    return () => {
      cancelled = true;
    };
  }, [client, effectiveId]);

  const recomputedCommit = verify ? commitHash(verify.serverSeed) : null;
  const recomputedRoll = verify ? rollFromSeeds(verify.serverSeed, verify.clientSeed, verify.missionId) : null;
  const commitOk = verify !== null && recomputedCommit === verify.serverSeedHash;
  const rollOk = verify !== null && recomputedRoll === verify.roll;

  // walk the table to the outcome band
  const target = verify ? Math.min(9_999, Math.floor(verify.roll * 10_000)) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl">Provably Fair</h1>
        <p className="text-sm text-muted">
          We can&apos;t move the cards after you&apos;ve bet. The outcome is fixed by a seed committed before the mission starts —
          recompute it yourself, right here.
        </p>
      </div>

      {resolved.length === 0 ? (
        <EmptyState line="No resolved jobs to audit yet." hint="Run a mission first — the receipt shows up here." />
      ) : (
        <>
          <select
            value={effectiveId ?? ""}
            onChange={(e) => setMissionId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent/60"
            aria-label="Pick a resolved mission"
          >
            {resolved.map((m) => (
              <option key={m.id} value={m.id}>
                {SEASON1_LOCATIONS.find((l) => l.slug === m.locationSlug)?.name ?? m.locationSlug} — {m.result.outcome} — {new Date(m.startedAt).toLocaleTimeString()}
              </option>
            ))}
          </select>

          {error && <ErrorState message={error} />}
          {!verify && !error && <Skeleton className="h-72 w-full" />}

          {verify && (
            <div className="space-y-4">
              <div className="card space-y-3 p-4">
                <Row label="server seed hash (committed pre-mission)" value={verify.serverSeedHash} />
                <Row label="server seed (revealed after resolution)" value={verify.serverSeed} />
                <Row label={`sha256(serverSeed) recomputed`} value={recomputedCommit ?? ""} ok={commitOk} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="client seed" value={verify.clientSeed} />
                  <Row label="mission id" value={verify.missionId} />
                </div>
                <Row label="roll = HMAC(serverSeed, clientSeed:missionId) / 2⁶⁴" value={`${verify.roll}`} ok={rollOk} />
              </div>

              <div className="card space-y-3 p-4">
                <div className="noir-label">
                  Walking the table — roll lands at {(verify.roll * 100).toFixed(2)}% (tick {target} of 10,000)
                </div>
                <ProbabilityTable table={verify.table} highlightOutcome={verify.outcome} />
                {/* cumulative walk strip */}
                <div className="relative mt-1 flex h-5 w-full overflow-hidden rounded-full border border-line">
                  {(() => {
                    let acc = 0;
                    return verify.table.map((row) => {
                      const left = acc;
                      acc += row.probabilityBps;
                      const hit = target >= left && target < acc;
                      return (
                        <div
                          key={row.outcome}
                          style={{ width: `${row.probabilityBps / 100}%` }}
                          className={clsx(
                            "h-full border-r border-bg/60 last:border-0",
                            row.outcome === "win" && "bg-success/70",
                            row.outcome === "jackpot" && "bg-jackpot/80",
                            row.outcome === "nothing" && "bg-slate-600/70",
                            row.outcome === "arrest" && "bg-pd/70",
                            row.outcome === "confiscation" && "bg-[#FF8A3C]/70",
                            (row.outcome === "rekt_items" || row.outcome === "rekt_character") && "bg-danger/70",
                            hit && "ring-2 ring-inset ring-white",
                          )}
                          title={`${row.outcome}: ${left}–${acc}`}
                        />
                      );
                    });
                  })()}
                  <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${verify.roll * 100}%` }} aria-hidden />
                </div>
                <p className="text-sm">
                  Outcome: <span className="font-display text-accent">{verify.outcome}</span>{" "}
                  <span className={clsx("text-xs font-bold", commitOk && rollOk ? "text-success" : "text-danger")}>
                    {commitOk && rollOk ? "— verified ✓" : "— verification failed"}
                  </span>
                </p>
              </div>

              <div className="card p-4">
                <div className="noir-label mb-2">The algorithm, in full</div>
                <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted">{verify.algorithm || PROVABLY_FAIR_ALGORITHM}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <VerifyInner />
    </Suspense>
  );
}
