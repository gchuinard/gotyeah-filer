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
import { mediaContentType } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toWeb(stream: import("node:fs").ReadStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Sert un fichier en streaming, après contrôle d'accès (admin OU invité
 * autorisé pour le partage de ce fichier précis — cf. `canAccessFile`).
 *
 * Deux modes :
 * - `?inline=1` : aperçu / lecture média (Content-Disposition: inline, cacheable,
 *   requêtes Range honorées pour le seek audio) → NE compte PAS comme un
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

  // filename* (UTF-8) pour les accents/emoji ; filename ASCII en repli.
  const fallback = file.original_name
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "'");

  const baseHeaders: Record<string, string> = {
    "Content-Type": mediaContentType(file.mime, file.original_name),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
      file.original_name,
    )}`,
    // Le MIME peut être déduit de l'extension : on empêche tout sniffing.
    "X-Content-Type-Options": "nosniff",
    // Aperçu : cacheable brièvement. Download : jamais stocké.
    "Cache-Control": inline ? "private, max-age=300" : "private, no-store",
    "Accept-Ranges": "bytes",
  };

  // Lecture média (inline) : on honore les requêtes Range pour permettre le
  // seek dans un audio. Le download (attachment) reste un flux complet, compté.
  const range = inline ? request.headers.get("range") : null;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response("Range non satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      end = Math.min(end, size - 1);
      return new Response(toWeb(createReadStream(path, { start, end })), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  // Seul un vrai téléchargement (pas un aperçu/lecture inline) incrémente le compteur.
  if (!inline) {
    incrementDownloadCount(id);
  }

  return new Response(toWeb(createReadStream(path)), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
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
