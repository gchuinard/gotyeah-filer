"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WithAdvance = { id: string; advance_ms: number | null };

/** ms (stocké) → secondes (saisie), "" si pas de minuteur. */
export function advanceMsToSecs(ms: number | null): string {
  return ms != null && ms > 0 ? String(Math.round(ms / 1000)) : "";
}

/** secondes (saisie) → ms (stocké), null si vide / 0 / invalide. */
export function advanceSecsToMs(input: string): number | null {
  const t = input.trim();
  const n = Math.floor(Number(t));
  return t !== "" && Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

/**
 * Durée d'auto-avance par image (ms), persistée EN BASE via
 * `PATCH /api/files/[id] { advanceMs }`. Même mécanique que les notes
 * (cf. `useFileNotes`) : état optimiste + sauvegarde différée (debounce 500 ms) +
 * flush au démontage. `null` = pas d'auto-avance sur cette image.
 *
 * NB : la valeur pouvant être `null` (valide), on teste la PRÉSENCE de la clé
 * (`id in edits`) et pas `?? serveur` (qui confondrait « pas de minuteur » et
 * « pas d'édition locale »).
 */
export function useFileAdvance(files: WithAdvance[]) {
  // Éditions locales (priment sur la valeur serveur) : id → ms | null.
  const [edits, setEdits] = useState<Record<string, number | null>>({});

  const advanceOf = useCallback(
    (id: string): number | null =>
      id in edits
        ? edits[id]
        : (files.find((f) => f.id === id)?.advance_ms ?? null),
    [edits, files],
  );

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, number | null>>({});

  const save = (id: string, value: number | null) => {
    void fetch(`/api/files/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ advanceMs: value }),
    }).catch(() => {});
  };

  const flush = useCallback((id: string) => {
    if (!(id in pending.current)) return;
    const value = pending.current[id];
    delete pending.current[id];
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
    save(id, value);
  }, []);

  const setAdvance = useCallback(
    (id: string, value: number | null) => {
      setEdits((e) => ({ ...e, [id]: value }));
      pending.current[id] = value;
      if (timers.current[id]) clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => flush(id), 500);
    },
    [flush],
  );

  // Au démontage : envoie immédiatement les sauvegardes encore en attente.
  useEffect(() => {
    const timersMap = timers.current;
    const pendingMap = pending.current;
    return () => {
      for (const id of Object.keys(pendingMap)) {
        if (timersMap[id]) clearTimeout(timersMap[id]);
        save(id, pendingMap[id]);
      }
    };
  }, []);

  return { advanceOf, setAdvance };
}
