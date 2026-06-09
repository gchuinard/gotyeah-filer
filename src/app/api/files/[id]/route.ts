import type { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { canAccessFile } from "@/lib/access";
import {
  deleteFileCompletely,
  getFile,
  incrementDownloadCount,
  moveFile,
  storedFilePath,
} from "@/lib/files";
import { getFolder } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sert un fichier en streaming, après contrôle d'accès (admin OU invité
 * autorisé pour le partage de ce fichier précis — cf. `canAccessFile`).
 *
 * Deux modes :
 * - `?inline=1` : aperçu (Content-Disposition: inline, cacheable côté client),
 *   utilisé pour les vignettes/prévisualisations → NE compte PAS comme un
 *   téléchargement.
 * - défaut : pièce jointe (attachment, no-store) → incrémente le compteur.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  // Auth d'abord (avant tout lookup) pour ne pas révéler l'existence d'un id.
  if (!canAccessFile(session, id)) {
    return new Response("Accès refusé", { status: 403 });
  }

  const file = getFile(id);
  if (!file) return new Response("Introuvable", { status: 404 });

  const path = storedFilePath(file.stored_name);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("Fichier manquant sur le disque", { status: 404 });
  }

  const inline = request.nextUrl.searchParams.has("inline");

  const body = Readable.toWeb(
    createReadStream(path),
  ) as unknown as ReadableStream<Uint8Array>;

  // filename* (UTF-8) pour les accents/emoji ; filename ASCII en repli.
  const fallback = file.original_name
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "'");

  // Seul un vrai téléchargement (pas un aperçu inline) incrémente le compteur.
  if (!inline) {
    incrementDownloadCount(id);
  }

  return new Response(body, {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
        file.original_name,
      )}`,
      // Le MIME est fourni par le client à l'upload : on empêche le sniffing.
      "X-Content-Type-Options": "nosniff",
      // Aperçu : cacheable brièvement côté client. Download : jamais stocké.
      "Cache-Control": inline ? "private, max-age=300" : "private, no-store",
    },
  });
}

/** Suppression d'un fichier (admin uniquement) : base + partages + disque. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const ok = await deleteFileCompletely(id);
  if (!ok) return new Response("Introuvable", { status: 404 });

  return new Response(null, { status: 204 });
}

/** Déplace un fichier dans un dossier (admin) : corps JSON { folderId: string|null }. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  if (!getFile(id)) return new Response("Introuvable", { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const raw = (body as { folderId?: unknown })?.folderId;
  let folderId: string | null = null;
  if (raw != null && raw !== "") {
    folderId = String(raw);
    if (!getFolder(folderId)) {
      return Response.json({ error: "Dossier introuvable." }, { status: 400 });
    }
  }

  moveFile(id, folderId);
  return new Response(null, { status: 204 });
}
