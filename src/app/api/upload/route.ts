import type { NextRequest } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getSession } from "@/lib/auth";
import { getMaxUploadBytes } from "@/lib/config";
import { filesDir, insertFile, storedFilePath } from "@/lib/files";

// Module natif (better-sqlite3) + fs : runtime Node obligatoire.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nettoie le nom d'origine (affichage / Content-Disposition uniquement). */
function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || "fichier";
}

/**
 * Upload d'UN fichier, envoyé en corps brut (pas de multipart) avec son nom
 * dans l'en-tête `x-filename`. Le flux est écrit sur disque en streaming, sans
 * jamais charger le fichier entier en mémoire. Le client envoie un POST par
 * fichier (le drag & drop multiple en émet plusieurs en parallèle).
 *
 * NB : cette route n'est PAS couverte par proxy.ts → on vérifie l'auth ici.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return Response.json({ error: "Accès refusé." }, { status: 403 });
  }

  const rawName = request.headers.get("x-filename");
  if (!rawName) {
    return Response.json(
      { error: "En-tête x-filename manquant." },
      { status: 400 },
    );
  }
  let originalName: string;
  try {
    originalName = sanitizeName(decodeURIComponent(rawName));
  } catch {
    originalName = sanitizeName(rawName);
  }

  const mime = request.headers.get("content-type") || "application/octet-stream";
  const maxBytes = getMaxUploadBytes();

  // Pré-rejet si la taille annoncée dépasse déjà la limite.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    return Response.json({ error: "Fichier trop volumineux." }, { status: 413 });
  }

  if (!request.body) {
    return Response.json({ error: "Corps de requête vide." }, { status: 400 });
  }

  await mkdir(filesDir(), { recursive: true });
  const id = crypto.randomUUID();
  const dest = storedFilePath(id);

  // Compte les octets au fil de l'eau et coupe net au-delà de la limite.
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
      createWriteStream(dest),
    );
  } catch (err) {
    await unlink(dest).catch(() => {});
    if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
      return Response.json(
        { error: "Fichier trop volumineux." },
        { status: 413 },
      );
    }
    return Response.json({ error: "Échec de l'écriture." }, { status: 500 });
  }

  if (written === 0) {
    await unlink(dest).catch(() => {});
    return Response.json({ error: "Fichier vide." }, { status: 400 });
  }

  try {
    insertFile({
      id,
      stored_name: id,
      original_name: originalName,
      size: written,
      mime,
      created_at: Date.now(),
    });
  } catch {
    // Évite un fichier orphelin sur disque si l'enregistrement en base échoue.
    await unlink(dest).catch(() => {});
    return Response.json(
      { error: "Échec de l'enregistrement." },
      { status: 500 },
    );
  }

  return Response.json(
    { id, name: originalName, size: written },
    { status: 201 },
  );
}
