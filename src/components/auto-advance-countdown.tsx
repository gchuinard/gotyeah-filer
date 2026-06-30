"use client";

import { useEffect, useState, type ReactNode } from "react";
import { clockElapsed, type Clock } from "@/lib/use-presenter-timer";

/**
 * Indicateur de décompte de l'auto-avance, AFFICHÉ dans la régie. Présentationnel
 * et ISOLÉ : il tique pour l'affichage (setInterval local) SANS faire re-rendre la
 * régie (même principe que `PresenterTimer` — la régie ne re-rend pas 4×/s).
 *
 * Lit le chrono « image » (`slide`) : quand le présentateur est en pause, le
 * `slide` ne progresse pas → le décompte se fige de lui-même (`clockElapsed`
 * ignore `now` si l'horloge est en pause). Tique uniquement quand ça décompte.
 *
 * Si l'auto-avance n'est pas armée (pas de durée, écran public fermé, dernière
 * image…), rend `children` à la place (le texte d'aide statique).
 */
export function AutoAdvanceCountdown({
  advanceMs,
  slide,
  running,
  active,
  children,
}: {
  advanceMs: number | null | undefined;
  slide: Clock;
  running: boolean;
  /** `publicOpen && index < max` : l'auto-avance peut réellement se déclencher. */
  active: boolean;
  children?: ReactNode;
}) {
  const visible = active && !!advanceMs && advanceMs > 0;
  const [now, setNow] = useState(() => Date.now());

  // Tique uniquement quand ça décompte vraiment (visible ET en marche). En pause,
  // l'affichage est figé par `clockElapsed` → inutile de tiquer. Le `setTimeout(0)`
  // ré-ancre `now` DÈS l'armement (sinon, après une longue inactivité sans tick,
  // `now` serait périmé vs un `slide.since` fraîchement ancré → décompte gonflé) ;
  // setState dans un callback de timer → pas de `set-state-in-effect`.
  useEffect(() => {
    if (!visible || !running) return;
    const tick = () => setNow(Date.now());
    const kick = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, [visible, running, slide]);

  if (!visible || !advanceMs) return <>{children}</>;

  // Bornage [0, advanceMs] : un `now` périmé juste après (ré)armement donnerait un
  // `clockElapsed` négatif → `remaining` au-dessus de la durée. On le plafonne.
  const remainingMs = Math.min(
    advanceMs,
    Math.max(0, advanceMs - clockElapsed(slide, now)),
  );
  const secs = Math.ceil(remainingMs / 1000);
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-400">
      <span className="tabular-nums">⏱ image suivante dans {secs}&nbsp;s</span>
      {!running && <span className="text-zinc-500">(en pause)</span>}
    </p>
  );
}
