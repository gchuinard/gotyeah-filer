import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessFolder } from "@/lib/access";
import { getFolder } from "@/lib/folders";
import { listFilesInFolder } from "@/lib/files";
import { zipFilesResponse } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Télécharge tout un dossier sous forme d'archive .zip (streaming), après
 * contrôle d'accès (admin OU invité d'un partage de ce dossier).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!canAccessFolder(session, id)) {
    return new Response("Accès refusé", { status: 403 });
  }

  const folder = getFolder(id);
  if (!folder) return new Response("Introuvable", { status: 404 });

  const resp = await zipFilesResponse(
    listFilesInFolder(id),
    `${folder.name || "dossier"}.zip`,
  );
  return resp ?? new Response("Aucun fichier disponible", { status: 404 });
}
