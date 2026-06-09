import type { SessionPayload } from "@/lib/session";
import { getShare } from "@/lib/shares";

/**
 * Un visiteur peut-il accéder à CE fichier (consultation / download) ?
 * - admin : oui, tout fichier.
 * - invité : seulement si sa session porte le token d'un partage qui pointe
 *   sur ce fichier précis (scopé au fichier, pas juste « connecté »).
 */
export function canAccessFile(
  session: SessionPayload | null,
  fileId: string,
): boolean {
  if (session?.role === "admin") return true;
  if (session?.role === "guest" && session.share) {
    const share = getShare(session.share);
    return !!share && share.file_id === fileId;
  }
  return false;
}
