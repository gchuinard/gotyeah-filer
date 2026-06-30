/* Protocole de la TÉLÉCOMMANDE de projection : piloter depuis un téléphone la
 * projection qui tourne sur un PC. Types PARTAGÉS côté client (la régie
 * `projection-regie.tsx` et la page `/admin/remote`). Le relais serveur (en
 * mémoire) est dans `projection-relay.ts`. Transport : SSE pour recevoir,
 * POST pour émettre (cf. `app/api/projection/*`). */

import { type Adjust } from "@/lib/image-adjust";

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
  /** Image courante retouchable ? (image matricielle, SVG exclu). */
  editable: boolean;
  /** Durée d'auto-avance (ms) de l'image courante, ou null (= aucune). */
  advanceMs?: number | null;
  /** Auto-avance réellement armée côté régie (écran public ouvert ET pas la
   * dernière image) → le téléphone n'affiche le décompte que dans ce cas. */
  advanceActive?: boolean;
  /**
   * Accusé de réception : dernier `seq` de commande reçu par la régie. Le canal
   * tél→régie étant best-effort (perte possible si le SSE de la régie est figé),
   * le téléphone compare ce champ au `seq` de sa dernière commande pour signaler
   * une commande non confirmée et réémettre les commandes idempotentes.
   */
  ackSeq?: number;
};

export type RemoteMsg =
  /** télécommande → régie : avancer / reculer d'une image. (conservé ; le tél émet `goto`.) */
  | { type: "go"; dir: 1 | -1; seq?: number }
  /** télécommande → régie : aller à une position précise (idempotent). */
  | { type: "goto"; index: number; seq?: number }
  /** télécommande → régie : écran public noir (on/off, idempotent). */
  | { type: "black"; on: boolean; seq?: number }
  /** télécommande → régie : édite la note du fichier `id` (persistée en base). */
  | { type: "note"; id: string; value: string }
  /** télécommande → régie : règle l'auto-avance du fichier `id` (ms ; null = aucune). */
  | { type: "advance"; id: string; ms: number | null }
  /** télécommande → régie : pilote le chrono (pause/reprise ou remise à zéro). */
  | { type: "timer"; action: "toggle" | "reset"; seq?: number }
  /**
   * télécommande → régie : réglage de retouche LIVE de l'image `id` (la régie le
   * rediffuse à la fenêtre publique). `adjust: null` retire le filtre.
   */
  | { type: "adjust"; id: string; adjust: Adjust | null }
  /**
   * télécommande → régie : APPLIQUE la retouche en écrasant l'original (la régie
   * fait le rendu canvas + PUT, puis rafraîchit le projecteur). Destructif.
   */
  | { type: "retouch"; id: string; adjust: Adjust }
  /** télécommande → régie : (re)demande l'état courant. */
  | { type: "request-state" }
  /** régie → télécommande : état courant (image, suivante, position, noir, note, chrono). */
  | ({ type: "state" } & RemoteState)
  /** régie → télécommande : résultat d'un écrasement de retouche (succès/échec). */
  | { type: "retouch-done"; ok: boolean };
