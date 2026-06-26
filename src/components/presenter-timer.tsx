"use client";

import { useEffect, useState } from "react";

/** Formate une durée en h:mm:ss (heures masquées si nulles). */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Horloge : cumul figé (`base`) + instant de reprise (`since`, `null` = pause). */
type Clock = { base: number; since: number | null };
function elapsed(c: Clock, now: number): number {
  return c.base + (c.since != null ? now - c.since : 0);
}

/**
 * Chrono du mode présentateur : temps TOTAL écoulé + temps sur l'IMAGE courante
 * (remis à zéro à chaque changement, sans toucher au total). Pause / reprise /
 * remise à zéro. Ancré sur des timestamps (pas de dérive). Démarre
 * automatiquement (la présentation commence à l'ouverture de la régie).
 */
export function PresenterTimer({ index }: { index: number }) {
  const [running, setRunning] = useState(true);
  // Instant courant, rafraîchi ~4×/s tant que ça tourne. Lu pendant le render à
  // la place de Date.now() (interdit pendant le render : règle react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  const [total, setTotal] = useState<Clock>(() => ({
    base: 0,
    since: Date.now(),
  }));
  const [slide, setSlide] = useState<Clock>(() => ({
    base: 0,
    since: Date.now(),
  }));

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  // Changement d'image → chrono « image » à zéro (le total continue).
  useEffect(() => {
    const reset = () => {
      const t = Date.now();
      setSlide({ base: 0, since: running ? t : null });
      setNow(t);
    };
    reset();
    // `running` lu à l'instant du changement, pas une dépendance (sinon on
    // remettrait le chrono image à zéro à chaque pause/reprise).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function toggle() {
    const t = Date.now();
    if (running) {
      setTotal((c) => ({ base: elapsed(c, t), since: null }));
      setSlide((c) => ({ base: elapsed(c, t), since: null }));
    } else {
      setTotal((c) => ({ ...c, since: t }));
      setSlide((c) => ({ ...c, since: t }));
    }
    setNow(t);
    setRunning((r) => !r);
  }

  function resetAll() {
    const t = Date.now();
    const since = running ? t : null;
    setTotal({ base: 0, since });
    setSlide({ base: 0, since });
    setNow(t);
  }

  const totalMs = elapsed(total, now);
  const slideMs = elapsed(slide, now);

  return (
    <div className="rounded-xl border border-zinc-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-500">Chrono</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            {running ? "Pause" : "Reprendre"}
          </button>
          <button
            type="button"
            onClick={resetAll}
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
