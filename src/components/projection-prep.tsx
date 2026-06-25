"use client";

import { type PreloadState } from "@/lib/use-image-preload";

/**
 * Contrôle « mode projection hors-ligne » (toolbar admin & invité). Active le
 * préchargement des images de la vue courante en mémoire pour que la projection
 * (lightbox) lise depuis des blobs locaux — la navigation image→image ne dépend
 * plus du réseau (pas de 404 en plein spectacle si la connexion hoquette).
 *
 * Purement présentationnel : l'état de préchargement vit dans le parent (qui
 * possède la liste `visible` et la lightbox) via `useImagePreload`.
 */
export function ProjectionPrep({
  imageCount,
  enabled,
  onToggle,
  state,
}: {
  imageCount: number;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  state: PreloadState;
}) {
  // Rien à projeter hors-ligne s'il n'y a pas d'image dans la vue.
  if (imageCount === 0) return null;

  const { ready, total, failed } = state;
  const done = ready + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = enabled && total > 0 && done >= total;

  return (
    <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200">
            Projection hors-ligne
          </p>
          <p className="text-xs text-zinc-500">
            {enabled
              ? allDone
                ? failed === 0
                  ? `✓ ${ready} image${ready > 1 ? "s" : ""} prête${ready > 1 ? "s" : ""} — navigation sans réseau`
                  : `${ready}/${total} prêtes · ${failed} non chargée${failed > 1 ? "s" : ""}`
                : `Préparation ${done}/${total}…`
              : `${imageCount} image${imageCount > 1 ? "s" : ""} à mettre en cache`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          className={
            enabled
              ? "shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
              : "shrink-0 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white"
          }
        >
          {enabled ? "Désactiver" : "Préparer"}
        </button>
      </div>

      {/* Barre de progression pendant le préchargement. */}
      {enabled && !allDone && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-300 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
