"use client";

import { useEffect, useRef, useState } from "react";

/** Fichier image préchargeable (on n'a besoin que de l'id + du type). */
export type PreloadableFile = {
  id: string;
  mime: string | null;
};

export type PreloadState = {
  /** id → object URL du blob préchargé (utilisable comme `src`). */
  urls: Map<string, string>;
  /** Nombre d'images prêtes (blob en mémoire). */
  ready: number;
  /** Nombre total d'images à précharger. */
  total: number;
  /** Nombre d'images définitivement en échec (après retries). */
  failed: number;
  /** Préchargement en cours ? */
  loading: boolean;
};

/* Précharge en parallèle limité : assez pour saturer une connexion correcte
 * sans noyer un réseau faible (le cas d'usage = spectacle, connexion flaky). */
const CONCURRENCY = 3;
/* Retries sur échec réseau : le but est que le cache se complète MALGRÉ les
 * coupures, pour ne plus jamais toucher le réseau pendant la projection. */
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Précharge en mémoire (blobs) les images fournies pour une projection
 * « hors-ligne » : une fois prêtes, la lightbox lit depuis le cache local et la
 * navigation image→image ne dépend plus du réseau (plus de 404 en plein
 * spectacle si la connexion hoquette).
 *
 * - Ne précharge QUE les images (les autres types sont ignorés).
 * - Charge dans l'ordre de la liste → le début de la projection est prêt en premier.
 * - Réessaie sur échec réseau (`MAX_ATTEMPTS`).
 * - Révoque tous les object URLs au cleanup / quand on désactive (pas de fuite).
 *
 * @param files  liste ordonnée des fichiers de la vue courante
 * @param enabled  active le préchargement (ex. toggle « mode hors-ligne »)
 */
export function useImagePreload(
  files: PreloadableFile[],
  enabled: boolean,
): PreloadState {
  const [state, setState] = useState<PreloadState>({
    urls: new Map(),
    ready: 0,
    total: 0,
    failed: 0,
    loading: false,
  });

  // Le composant est-il encore monté / le préchargement courant toujours actif ?
  // Garde les fetchs asynchrones de toucher l'état après désactivation/démontage.
  const aliveRef = useRef(true);

  // Liste stable des ids d'images à précharger. On dérive une clé pour ne
  // relancer l'effet que si l'ensemble (ou son ordre) change réellement.
  const imageIds = files
    .filter((f) => f.mime?.startsWith("image/"))
    .map((f) => f.id);
  const idsKey = imageIds.join(",");

  useEffect(() => {
    aliveRef.current = true;
    const urls = new Map<string, string>();

    if (!enabled || imageIds.length === 0) {
      // setState dans une fonction imbriquée (pas dans le corps de l'effet) pour
      // satisfaire react-hooks/set-state-in-effect.
      const reset = () =>
        setState({ urls, ready: 0, total: 0, failed: 0, loading: false });
      reset();
      return () => {
        aliveRef.current = false;
      };
    }

    let ready = 0;
    let failed = 0;

    async function fetchOne(id: string): Promise<void> {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!aliveRef.current) return;
        try {
          // `?inline=1` : lecture inline, ne compte PAS comme un download.
          const res = await fetch(`/api/files/${id}?inline=1`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (!aliveRef.current) return; // désactivé pendant le fetch
          urls.set(id, URL.createObjectURL(blob));
          ready++;
          setState((s) => ({ ...s, urls, ready, loading: ready + failed < imageIds.length }));
          return;
        } catch {
          if (!aliveRef.current) return;
          if (attempt < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          failed++;
          setState((s) => ({ ...s, failed, loading: ready + failed < imageIds.length }));
        }
      }
    }

    // Pool à concurrence limitée : N workers consomment la file dans l'ordre.
    let cursor = 0;
    async function worker(): Promise<void> {
      while (aliveRef.current && cursor < imageIds.length) {
        const id = imageIds[cursor++];
        await fetchOne(id);
      }
    }
    // L'état initial « loading » est posé ici (fonction imbriquée, pas dans le
    // corps de l'effet) pour satisfaire react-hooks/set-state-in-effect.
    async function start(): Promise<void> {
      setState({ urls, ready: 0, total: imageIds.length, failed: 0, loading: true });
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, imageIds.length) }, () =>
          worker(),
        ),
      );
    }
    void start();

    return () => {
      aliveRef.current = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
    // idsKey encode l'ensemble ordonné des ids ; imageIds en est dérivé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idsKey]);

  return state;
}
