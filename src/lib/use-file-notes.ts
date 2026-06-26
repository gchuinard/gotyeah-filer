"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WithNote = { id: string; note: string | null };

/**
 * Notes par fichier, persistées EN BASE via `PATCH /api/files/[id] { note }`.
 *
 * - Affichage : la note serveur (depuis `files`) sauf si une édition locale est
 *   en cours (qui prime).
 * - Frappe fluide : état optimiste + sauvegarde **différée** (debounce 500 ms),
 *   avec **flush au démontage** pour ne perdre aucune saisie (navigation, sortie
 *   du mode présentateur…).
 */
export function useFileNotes(files: WithNote[]) {
  // Éditions locales (priment sur la valeur serveur) : id → texte.
  const [edits, setEdits] = useState<Record<string, string>>({});

  const noteOf = useCallback(
    (id: string): string =>
      edits[id] ?? files.find((f) => f.id === id)?.note ?? "",
    [edits, files],
  );

  // Sauvegardes en attente (par id) + leur valeur, pour debounce et flush.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, string>>({});

  const save = (id: string, value: string) => {
    void fetch(`/api/files/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: value }),
    }).catch(() => {});
  };

  const flush = useCallback((id: string) => {
    const value = pending.current[id];
    if (value === undefined) return;
    delete pending.current[id];
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
    save(id, value);
  }, []);

  const setNote = useCallback(
    (id: string, value: string) => {
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

  return { noteOf, setNote };
}
