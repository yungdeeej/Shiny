"use client";

import { AnimatePresence } from "framer-motion";
import React, { useState } from "react";
import { useCharacters } from "../../lib/hooks";
import { useUiStore } from "../../lib/uiStore";
import { ResultTakeover } from "./ResultTakeover";
import { SuspenseModal } from "./SuspenseModal";

/**
 * Global resolution theatre: whenever a mission you own resolves (wherever you
 * are), play the security-cam suspense then the outcome takeover.
 */
export function MissionWatcher() {
  const queue = useUiStore((s) => s.resultQueue);
  const shift = useUiStore((s) => s.shiftResult);
  const handle = useUiStore((s) => s.handle);
  const { data: characters } = useCharacters();
  const [revealed, setRevealed] = useState(false);

  const current = queue[0];
  if (!current) return null;

  const character = current.mission.characterId
    ? characters?.find((c) => c.id === current.mission.characterId) ?? null
    : null;

  return (
    <AnimatePresence>
      {!revealed ? (
        <SuspenseModal key={`cam-${current.mission.id}`} locationName={current.locationName} onDone={() => setRevealed(true)} />
      ) : (
        <ResultTakeover
          key={`result-${current.mission.id}`}
          mission={current.mission}
          result={current.result}
          locationName={current.locationName}
          character={character}
          handle={handle ?? "you"}
          onClose={() => {
            setRevealed(false);
            shift();
          }}
          onVerify={() => {
            setRevealed(false);
            shift();
          }}
        />
      )}
    </AnimatePresence>
  );
}
