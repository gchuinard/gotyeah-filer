"use client";

import { useCallback, useEffect, useState } from "react";

const PREFIX = "filer:note:";

/**
 * Bloc-notes local PAR FICHIER pour le mode présentateur. Stockage
 * `localStorage` : persistant sur CE navigateur, perdu ailleurs — compromis
 * assumé (pas de champ en base ; les notes sont l'aide-mémoire de l'opérateur).
 *
 * SSR-safe : la lecture se fait dans un effet (jamais pendant le render). Le
 * `setState` est placé dans une fonction imbriquée pour satisfaire
 * `react-hooks/set-state-in-effect`.
 *
 * @param fileId  fichier courant (ou `null` → notes vides, saisie désactivée)
 * @returns `[note, setNote]` — `setNote` écrit aussi dans `localStorage`.
 */
export function useLocalNotes(
  fileId: string | null,
): [string, (value: string) => void] {
  const [note, setNote] = useState("");

  useEffect(() => {
    const load = () => {
      if (!fileId) {
        setNote("");
        return;
      }
      try {
        setNote(localStorage.getItem(PREFIX + fileId) ?? "");
      } catch {
        setNote("");
      }
    };
    load();
  }, [fileId]);

  const update = useCallback(
    (value: string) => {
      setNote(value);
      if (!fileId) return;
      try {
        if (value) localStorage.setItem(PREFIX + fileId, value);
        else localStorage.removeItem(PREFIX + fileId);
      } catch {
        /* quota plein / navigation privée : on garde au moins l'état en mémoire */
      }
    },
    [fileId],
  );

  return [note, update];
}
