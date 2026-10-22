import type { SessionPayload } from "@/lib/session";
import { getFile } from "@/lib/files";
import { getActiveShare, type ShareRow } from "@/lib/shares";

/** Partages ACTIFS (existants ET non expirés) ouverts par la session d'un invité. */
function activeGuestShares(session: SessionPayload | null): ShareRow[] {
  if (session?.role !== "guest") return [];
  return (session.shares ?? [])
    .map((token) => getActiveShare(token))
    .filter((s): s is ShareRow => s !== undefined);
}

/**
 * Un visiteur peut-il accéder à CE fichier (consultation / download) ?
 * - admin : oui, tout fichier.
 * - invité : seulement si l'un des partages ACTIFS (existant ET non expiré) de
 *   sa session couvre ce fichier précis :
 *     • partage de fichier  → le token cible directement ce fichier, ou
 *     • partage de dossier  → le fichier appartient au dossier partagé
 *       (« vivant » : un fichier ajouté/déplacé suit l'appartenance au dossier).
 */
export function canAccessFile(
  session: SessionPayload | null,
  fileId: string,
): boolean {
  if (session?.role === "admin") return true;
  const shares = activeGuestShares(session);
  if (shares.some((s) => s.file_id === fileId)) return true;
  const folderShares = shares.filter((s) => s.folder_id);
  if (folderShares.length === 0) return false;
  const file = getFile(fileId);
  return !!file && folderShares.some((s) => s.folder_id === file.folder_id);
}

/**
 * Un visiteur peut-il accéder à CE dossier (liste + zip) ?
 * - admin : oui. - invité : seulement si l'un des partages ACTIFS de sa session
 *   vise ce dossier.
 */
export function canAccessFolder(
  session: SessionPayload | null,
  folderId: string,
): boolean {
  if (session?.role === "admin") return true;
  return activeGuestShares(session).some((s) => s.folder_id === folderId);
}
