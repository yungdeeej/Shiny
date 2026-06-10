import React from "react";
import { PawPrint } from "../art/Logo";

export function EmptyState({ line, hint, action }: { line: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <PawPrint size={28} className="text-line" />
      <p className="font-display text-base text-muted">{line}</p>
      {hint && <p className="max-w-sm text-xs text-muted/70">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, retry }: { message?: string; retry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 border-danger/30 px-6 py-10 text-center">
      <span className="text-2xl" aria-hidden>🚧</span>
      <p className="font-display text-base text-danger">Something went sideways.</p>
      {message && <p className="max-w-sm text-xs text-muted">{message}</p>}
      {retry && (
        <button onClick={retry} className="rounded-xl border border-line bg-surface2 px-4 py-2 text-sm hover:border-muted/50">
          Try again
        </button>
      )}
    </div>
  );
}
