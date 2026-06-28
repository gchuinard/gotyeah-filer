/* Protocole de la TÉLÉCOMMANDE de projection : piloter depuis un téléphone la
 * projection qui tourne sur un PC. Types PARTAGÉS côté client (la régie
 * `projection-regie.tsx` et la page `/admin/remote`). Le relais serveur (en
 * mémoire) est dans `projection-relay.ts`. Transport : SSE pour recevoir,
 * POST pour émettre (cf. `app/api/projection/*`). */

export type RemoteFile = { id: string; name: string };

/** Instantané du chrono (la télécommande l'extrapole localement pour tiquer). */
export type RemoteTimer = { totalMs: number; slideMs: number; running: boolean };

/** État courant, poussé par la RÉGIE vers la télécommande. */
export type RemoteState = {
  index: number;
  total: number;
  current: RemoteFile | null;
  next: RemoteFile | null;
  black: boolean;
  /** Note (en base) de l'image courante — éditable depuis le téléphone. */
  note: string;
  /** Chrono du présentateur (instantané + état marche/pause). */
  timer: RemoteTimer;
};

export type RemoteMsg =
  /** télécommande → régie : avancer / reculer d'une image. */
  | { type: "go"; dir: 1 | -1 }
  /** télécommande → régie : aller à une position précise. */
  | { type: "goto"; index: number }
  /** télécommande → régie : écran public noir (on/off). */
  | { type: "black"; on: boolean }
  /** télécommande → régie : édite la note du fichier `id` (persistée en base). */
  | { type: "note"; id: string; value: string }
  /** télécommande → régie : pilote le chrono (pause/reprise ou remise à zéro). */
  | { type: "timer"; action: "toggle" | "reset" }
  /** télécommande → régie : (re)demande l'état courant. */
  | { type: "request-state" }
  /** régie → télécommande : état courant (image, suivante, position, noir, note, chrono). */
  | ({ type: "state" } & RemoteState);
