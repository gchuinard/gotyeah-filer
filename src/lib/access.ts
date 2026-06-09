import type { SessionPayload } from "@/lib/session";
import { getFile } from "@/lib/files";
import { getShare } from "@/lib/shares";

/**
 * Un visiteur peut-il accéder à CE fichier (consultation / download) ?
 * - admin : oui, tout fichier.
 * - invité : seulement si sa session porte le token d'un partage qui couvre ce
 *   fichier précis :
 *     • partage de fichier  → le token cible directement ce fichier, ou
 *     • partage de dossier  → le fichier appartient au dossier partagé
 *       (« vivant » : un fichier ajouté/déplacé suit l'appartenance au dossier).
 */
export function canAccessFile(
  session: SessionPayload | null,
  fileId: string,
): boolean {
  if (session?.role === "admin") return true;
  if (session?.role === "guest" && session.share) {
    const share = getShare(session.share);
    if (!share) return false;
    if (share.file_id) return share.file_id === fileId;
    if (share.folder_id) {
      const file = getFile(fileId);
      return !!file && file.folder_id === share.folder_id;
    }
  }
  return false;
}

/**
 * Un visiteur peut-il accéder à CE dossier (liste + zip) ?
 * - admin : oui. - invité : seulement si sa session porte un partage de ce dossier.
 */
export function canAccessFolder(
  session: SessionPayload | null,
  folderId: string,
): boolean {
  if (session?.role === "admin") return true;
  if (session?.role === "guest" && session.share) {
    const share = getShare(session.share);
    return !!share && share.folder_id === folderId;
  }
  return false;
}
