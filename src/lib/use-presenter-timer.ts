"use client";

import { useCallback, useEffect, useState } from "react";

/** Horloge : cumul figé (`base`) + instant de reprise (`since`, `null` = pause). */
export type Clock = { base: number; since: number | null };

/** Temps écoulé d'une horloge à l'instant `now` (ms). */
export function clockElapsed(c: Clock, now: number): number {
  return c.base + (c.since != null ? now - c.since : 0);
}

/**
 * État du chrono du présentateur : temps TOTAL + temps sur l'IMAGE courante
 * (remis à zéro à chaque changement d'image, sans toucher au total). Démarre
 * automatiquement, ancré sur des timestamps (pas de dérive).
 *
 * NE TIQUE PAS lui-même (les horloges ne changent qu'aux actions / changements
 * d'image) → l'affichage (`PresenterTimer`) calcule l'écoulé en tiquant de son
 * côté, et la régie ne re-rend pas 4×/s. Extrait pour être PARTAGÉ : la régie le
 * pilote (pause/reprise/reset, y compris via la télécommande) ET en pousse un
 * instantané au téléphone, qui l'extrapole localement (sans décalage d'horloge
 * entre appareils).
 */
export function usePresenterTimer(index: number) {
  const [running, setRunning] = useState(true);
  const [total, setTotal] = useState<Clock>(() => ({
    base: 0,
    since: Date.now(),
  }));
  const [slide, setSlide] = useState<Clock>(() => ({
    base: 0,
    since: Date.now(),
  }));

  // Changement d'image → chrono « image » à zéro (le total continue).
  useEffect(() => {
    const reset = () => {
      const t = Date.now();
      // `running` lu à l'instant du changement (pas une dépendance, sinon on
      // remettrait le chrono image à zéro à chaque pause/reprise).
      setSlide({ base: 0, since: running ? t : null });
    };
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Pause/reprise : on dérive l'état de `since` (≠ null ⟺ en cours) → callbacks
  // stables (utiles pour la commande de télécommande), pas besoin de lire `running`.
  const toggle = useCallback(() => {
    const t = Date.now();
    const flip = (c: Clock): Clock =>
      c.since != null
        ? { base: clockElapsed(c, t), since: null }
        : { ...c, since: t };
    setTotal(flip);
    setSlide(flip);
    setRunning((r) => !r);
  }, []);

  const resetAll = useCallback(() => {
    const t = Date.now();
    const zero = (c: Clock): Clock => ({ base: 0, since: c.since != null ? t : null });
    setTotal(zero);
    setSlide(zero);
  }, []);

  // Redémarre le SEUL chrono « image » à zéro (le total continue), en conservant
  // l'état marche/pause. Sert à (re)caler l'auto-avance quand la projection
  // démarre (ouverture de l'écran public) pour que l'image courante reparte de 0.
  const restartSlide = useCallback(() => {
    const t = Date.now();
    setSlide((c) => ({ base: 0, since: c.since != null ? t : null }));
  }, []);

  return { total, slide, running, toggle, resetAll, restartSlide };
}
