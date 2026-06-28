"use client";

import { useEffect, useState } from "react";
import { clockElapsed, type Clock } from "@/lib/use-presenter-timer";

/** Formate une durée en h:mm:ss (heures masquées si nulles). */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Affichage du chrono du présentateur (régie). L'état (horloges) vient de
 * `usePresenterTimer` chez le parent ; ce composant ne fait que TIQUER pour
 * afficher l'écoulé (re-render isolé ici, pas dans la régie) et exposer les
 * boutons pause/reprise/reset.
 */
export function PresenterTimer({
  total,
  slide,
  running,
  onToggle,
  onReset,
}: {
  total: Clock;
  slide: Clock;
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  // Instant courant, rafraîchi ~4×/s tant que ça tourne. Lu pendant le render à
  // la place de Date.now() (interdit pendant le render : règle react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick(); // resync immédiat sur changement d'état (pause/reprise/image)
    if (!running) return;
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [running, total, slide]);

  const totalMs = clockElapsed(total, now);
  const slideMs = clockElapsed(slide, now);

  return (
    <div className="rounded-xl border border-zinc-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-500">Chrono</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            {running ? "Pause" : "Reprendre"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="font-mono text-2xl tabular-nums text-zinc-100">
            {fmt(totalMs)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-zinc-600">
            total
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg tabular-nums text-zinc-400">
            {fmt(slideMs)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-zinc-600">
            image
          </p>
        </div>
      </div>
    </div>
  );
}
