"use client";

/**
 * Canal de synchronisation du « mode présentateur » (façon PowerPoint) entre la
 * fenêtre RÉGIE (l'opérateur : image courante, suivante, +notes/chrono en
 * Phase B) et la fenêtre PUBLIC (le 2e écran / vidéoprojecteur : l'image seule,
 * plein écran, sans chrome).
 *
 * Même origine → `BroadcastChannel` suffit (aucun serveur, temps réel). La régie
 * fait autorité sur la LISTE ; la position courante circule dans les DEUX sens
 * (on peut naviguer depuis la régie OU depuis la fenêtre public au clavier).
 *
 * Note importante : les object URLs de préchargement (« hors-ligne ») sont liés
 * à LEUR document — ils ne traversent PAS les fenêtres. La fenêtre public
 * précharge donc ses propres blobs et ne renvoie que sa PROGRESSION à la régie.
 */

import { type Adjust } from "@/lib/image-adjust";

export const PROJECTION_CHANNEL = "filer-projection";

/** Sous-ensemble d'un fichier nécessaire à l'affichage public. */
export type PublicFile = {
  id: string;
  original_name: string;
  mime: string | null;
};

export type ProjectionMessage =
  /** public → régie : fenêtre prête, demande l'état courant. */
  | { type: "hello" }
  /** régie → public : liste complète + position courante. */
  | { type: "sync"; files: PublicFile[]; index: number }
  /** ↔ : changement de position (depuis la régie OU la fenêtre public). */
  | { type: "index"; index: number }
  /** public → régie : progression du préchargement hors-ligne. */
  | { type: "progress"; ready: number; total: number; failed: number }
  /**
   * éditeur → fenêtres : réglage de retouche LIVE de l'image `id` (le projecteur
   * applique le filtre en temps réel). `adjust: null` retire le filtre.
   */
  | { type: "adjust"; id: string; adjust: Adjust | null }
  /**
   * éditeur → fenêtres : les octets de `id` ont été remplacés (« écraser
   * l'original ») → recharger l'image en contournant le cache et les blobs
   * préchargés (figés). `v` = jeton de cache-bust.
   */
  | { type: "reload"; id: string; v: number }
  /** régie → public : ferme-toi. */
  | { type: "close" }
  /** public → régie : je me ferme (l'opérateur saura que l'écran est parti). */
  | { type: "public-closed" };

/** Ouvre le canal (ou `null` si indisponible : SSR, navigateur trop ancien). */
export function openProjectionChannel(): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }
  return new BroadcastChannel(PROJECTION_CHANNEL);
}
