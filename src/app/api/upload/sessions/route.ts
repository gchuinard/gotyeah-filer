import type { NextRequest } from "next/server";
import { mkdir, open, rm } from "node:fs/promises";
import { getSession } from "@/lib/auth";
import { getMaxUploadBytes } from "@/lib/config";
import { getFolder } from "@/lib/folders";
import { formatBytes } from "@/lib/format";
import {
  UPLOAD_CHUNK_BYTES,
  type UploadInitResponse,
} from "@/lib/upload-protocol";
import {
  createUploadRow,
  discardSameFingerprint,
  freeBytes,
  partPath,
  pendingUploadBytes,
  purgeStaleUploads,
  sanitizeName,
  serializeUploadInit,
  uploadsDir,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marge de place disque gardée libre en plus du fichier annoncé. */
const SPACE_MARGIN_BYTES = 1024 * 1024 * 1024;

function json(data: unknown, status: number): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Ouvre une session d'upload par morceaux (admin) : valide la taille annoncée
 * contre `MAX_UPLOAD_MB` et contre la place disque AVANT le premier octet, puis
 * crée la ligne `uploads` et un partiel vide. Corps JSON `UploadInitRequest`.
 * Les morceaux arrivent ensuite par `PUT /api/upload/sessions/<id>`.
 *
 * NB : cette route n'est PAS couverte par proxy.ts → on vérifie l'auth ici.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return json({ error: "Accès refusé." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }

  const { name, size, mime, folderId, lastModified, parallel } = body;
  // Mode parallèle (morceaux numérotés, écrits à leur place) si le client le
  // demande ; sinon mode séquentiel historique (onglet chargé avant la mise à jour).
  const chunkSize = parallel === true ? UPLOAD_CHUNK_BYTES : null;
  if (typeof name !== "string" || name.trim() === "") {
    return json({ error: "Nom de fichier manquant." }, 400);
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    return json({ error: "Taille de fichier invalide." }, 400);
  }
  if (size === 0) return json({ error: "Fichier vide." }, 400);

  const maxBytes = getMaxUploadBytes();
  if (size > maxBytes) {
    return json(
      { error: `Fichier trop volumineux (maximum ${formatBytes(maxBytes)}).` },
      413,
    );
  }

  const now = Date.now();
  const originalName = sanitizeName(name);
  const fingerprint = `${originalName}|${size}|${
    typeof lastModified === "number" && Number.isFinite(lastModified)
      ? lastModified
      : ""
  }`;

  // Dossier invalide/obsolète → racine, comme l'upload d'un bloc (revérifié à
  // la finalisation : il peut disparaître pendant un envoi de plusieurs heures).
  const folder =
    typeof folderId === "string" && getFolder(folderId) ? folderId : null;

  // Purge → mesure → réservation (la ligne) d'un seul tenant : sérialisé, sinon
  // deux ouvertures simultanées verraient la même place libre.
  return serializeUploadInit(async () => {
    // Récupère la place des envois abandonnés AVANT de mesurer le disque.
    await purgeStaleUploads(now);
    await discardSameFingerprint(fingerprint);

    const free = await freeBytes();
    if (free !== null) {
      const reserved = await pendingUploadBytes();
      if (free - reserved < size + SPACE_MARGIN_BYTES) {
        return json(
          {
            error: `Espace disque insuffisant : ce fichier fait ${formatBytes(
              size,
            )}, il reste ${formatBytes(Math.max(0, free - reserved))} de libre.`,
          },
          507,
        );
      }
    }

    const id = crypto.randomUUID();
    try {
      await mkdir(uploadsDir(), { recursive: true });
      // Partiel d'abord, ligne ensuite : un crash entre les deux laisse un
      // orphelin que la purge reconnaît (pas de ligne sans partiel).
      await (await open(partPath(id), "wx")).close();
      createUploadRow({
        id,
        original_name: originalName,
        size,
        mime:
          typeof mime === "string" && mime !== ""
            ? mime.slice(0, 255)
            : "application/octet-stream",
        folder_id: folder,
        fingerprint,
        created_at: now,
        updated_at: now,
        chunk_size: chunkSize,
      });
    } catch {
      await rm(partPath(id), { force: true }).catch(() => {});
      return json({ error: "Impossible d'ouvrir l'envoi." }, 500);
    }

    const res: UploadInitResponse = {
      id,
      chunkSize: UPLOAD_CHUNK_BYTES,
      parallel: chunkSize !== null,
    };
    return json(res, 201);
  });
}
