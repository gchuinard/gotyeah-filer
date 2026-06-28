import type { NextRequest } from "next/server";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getSession } from "@/lib/auth";
import { canAccessFile } from "@/lib/access";
import { getMaxUploadBytes } from "@/lib/config";
import {
  deleteFileCompletely,
  filesDir,
  getFile,
  incrementDownloadCount,
  moveFile,
  setFileNote,
  storedFilePath,
  updateFileBlob,
} from "@/lib/files";
import { getFolder } from "@/lib/folders";
import { isInlineSafe, mediaContentType } from "@/lib/media";

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

  // On ne sert EN LIGNE que les types « inertes » sûrs (image hors SVG, audio,
  // vidéo, PDF) ; sinon on force le téléchargement même si `?inline=1` est passé
  // (un .html/.svg servi inline s'exécuterait sur notre origine).
  const inline =
    request.nextUrl.searchParams.has("inline") &&
    isInlineSafe(file.mime, file.original_name);

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

/**
 * Écrase les octets d'un fichier existant (admin) : sert la retouche « Écraser
 * l'original ». Écriture en streaming vers un fichier temporaire puis `rename`
 * atomique par-dessus l'ancien → en cas d'échec, l'original n'est jamais corrompu.
 * On met à jour `size`/`mime` mais on conserve `id`, `stored_name`, `created_at`,
 * le dossier et les partages → l'image garde sa place. Corps = nouvelles données
 * brutes (comme `/api/upload`). DESTRUCTIF et irréversible (cf. confirmation côté UI).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  const file = getFile(id);
  if (!file) return new Response("Introuvable", { status: 404 });
  if (!request.body) {
    return Response.json({ error: "Corps de requête vide." }, { status: 400 });
  }

  // Type dérivé de l'original (l'extension ne change pas) — on ne fait PAS
  // confiance au content-type du client, et c'est cohérent avec le service GET.
  const mime = mediaContentType(file.mime, file.original_name);
  const maxBytes = getMaxUploadBytes();
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    return Response.json({ error: "Fichier trop volumineux." }, { status: 413 });
  }

  await mkdir(filesDir(), { recursive: true });
  const dest = storedFilePath(file.stored_name);
  // Temp + rename : l'original reste intact tant que le nouveau n'est pas complet.
  const tmp = `${dest}.tmp-${crypto.randomUUID()}`;

  let written = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > maxBytes) {
        cb(new Error("FILE_TOO_LARGE"));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
      limiter,
      createWriteStream(tmp),
    );
  } catch (err) {
    await unlink(tmp).catch(() => {});
    if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
      return Response.json(
        { error: "Fichier trop volumineux." },
        { status: 413 },
      );
    }
    return Response.json({ error: "Échec de l'écriture." }, { status: 500 });
  }

  if (written === 0) {
    await unlink(tmp).catch(() => {});
    return Response.json({ error: "Fichier vide." }, { status: 400 });
  }

  try {
    await rename(tmp, dest);
  } catch {
    await unlink(tmp).catch(() => {});
    return Response.json(
      { error: "Échec de l'enregistrement." },
      { status: 500 },
    );
  }

  try {
    if (!updateFileBlob(id, written, mime)) {
      // Le fichier a disparu de la base entre-temps (course rare).
      return Response.json({ error: "Fichier introuvable." }, { status: 404 });
    }
  } catch {
    // Les octets sont déjà remplacés sur disque (et servis via `stat`) ; seule
    // la métadonnée `size` peut rester périmée (cosmétique dans la liste).
    return Response.json(
      { error: "Image remplacée, mais mise à jour des métadonnées échouée." },
      { status: 500 },
    );
  }
  return Response.json({ id, size: written }, { status: 200 });
}

/**
 * Met à jour un fichier (admin). Corps JSON, chaque clé est optionnelle et
 * traitée seulement si PRÉSENTE : `{ folderId: string|null }` déplace,
 * `{ note: string|null }` met à jour la note libre. (Ne pas déplacer à la racine
 * quand on ne met à jour que la note.)
 */
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
  const data = (body ?? {}) as { folderId?: unknown; note?: unknown };

  // Note libre (uniquement si la clé est présente dans le corps).
  if ("note" in data) {
    if (data.note !== null && typeof data.note !== "string") {
      return Response.json({ error: "Note invalide." }, { status: 400 });
    }
    setFileNote(id, data.note ?? null);
  }

  // Déplacement (uniquement si la clé est présente).
  if ("folderId" in data) {
    const raw = data.folderId;
    let folderId: string | null = null;
    if (raw != null && raw !== "") {
      folderId = String(raw);
      if (!getFolder(folderId)) {
        return Response.json({ error: "Dossier introuvable." }, { status: 400 });
      }
    }
    moveFile(id, folderId);
  }

  return new Response(null, { status: 204 });
}
