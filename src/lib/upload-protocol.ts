/* Protocole de l'UPLOAD PAR MORCEAUX (gros fichiers). Constantes et types
 * PARTAGÉS client/serveur — aucun import Node ici. Le serveur est dans
 * `src/lib/uploads.ts` + `app/api/upload/sessions/*`, le client dans
 * `src/lib/upload-queue.ts`.
 *
 * Pourquoi des morceaux : sur le chemin navigateur → Cloudflare → NPM → Node,
 * un fichier envoyé d'un bloc bute sur trois plafonds — Cloudflare refuse un
 * corps > 100 Mo, NPM plafonne tout hôte à 25 Mo (hors dérogation scopée
 * `/api/upload`), et Node coupe en 408 toute requête encore en réception après
 * 300 s (`requestTimeout` par défaut, que Next standalone ne change pas).
 *
 * Déroulé : POST `/api/upload/sessions` (métadonnées) → `{ id }`, puis PUT
 * `/api/upload/sessions/<id>` de chaque morceau, l'un après l'autre, avec
 * l'offset attendu dans `x-upload-offset`. La position fait foi CÔTÉ SERVEUR
 * (taille réelle du fichier partiel) : après tout échec, le client relit
 * l'état par GET avant de renvoyer quoi que ce soit. */

/** Taille d'un morceau envoyé par le client : 16 Mio. Sous les 25 Mo de NPM
 * (même sans la dérogation), sous les 100 Mo de Cloudflare, et quelques
 * secondes par requête — loin des 300 s de Node. */
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

/** Plafond d'un morceau accepté par le serveur (marge sur le client, toujours
 * sous les 25 Mo de NPM). */
export const UPLOAD_MAX_CHUNK_BYTES = 24 * 1024 * 1024;

/** En-tête portant l'offset auquel le client pense écrire ce morceau. */
export const UPLOAD_OFFSET_HEADER = "x-upload-offset";

/** Forme d'un id de session (= `crypto.randomUUID()`), vérifiée AVANT de
 * construire le moindre chemin disque à partir de l'URL. */
export const UPLOAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Corps du POST `/api/upload/sessions`. */
export type UploadInitRequest = {
  name: string;
  size: number;
  mime: string;
  folderId: string | null;
  /** `File.lastModified` : sert d'empreinte avec nom + taille, pour remplacer
   * un envoi abandonné du même fichier au lieu de garder deux partiels. */
  lastModified: number;
};

/** Réponse 201 du POST `/api/upload/sessions`. */
export type UploadInitResponse = { id: string; chunkSize: number };

/** État d'un envoi (GET, et corps des réponses PUT / 409). `done` : le fichier
 * est complet et enregistré — son id est celui de la session. */
export type UploadStatus = {
  offset: number;
  size: number;
  done: boolean;
  /** Un morceau est en cours d'écriture pour cette session (GET seulement). */
  busy?: boolean;
  error?: string;
};
