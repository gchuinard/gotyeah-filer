import type { NextRequest } from "next/server";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { getSession } from "@/lib/auth";
import { canAccessFolder } from "@/lib/access";
import { getFolder } from "@/lib/folders";
import {
  incrementDownloadCount,
  listFilesInFolder,
  storedFilePath,
} from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rend un nom d'entrée unique dans l'archive (suffixe « (n) » si collision). */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 1;
  let candidate: string;
  do {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  } while (used.has(candidate.toLowerCase()));
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Télécharge tout un dossier sous forme d'archive .zip (streaming), après
 * contrôle d'accès (admin OU invité d'un partage de ce dossier).
 * Chaque fichier inclus compte comme un téléchargement.
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

  const files = listFilesInFolder(id);
  if (files.length === 0) {
    return new Response("Dossier vide", { status: 404 });
  }

  // Pré-vérification disque : on n'embarque que les fichiers réellement présents.
  // Indispensable car yazl émet ses erreurs de lecture sur l'instance ZipFile
  // (pas sur outputStream) ; sans listener, un fichier manquant ferait planter
  // le process. On évite aussi de compter un fichier qu'on ne livrera pas.
  const present = (
    await Promise.all(
      files.map(async (f) => {
        try {
          await stat(storedFilePath(f.stored_name));
          return f;
        } catch {
          return null;
        }
      }),
    )
  ).filter((f): f is (typeof files)[number] => f !== null);

  if (present.length === 0) {
    return new Response("Aucun fichier disponible", { status: 404 });
  }

  const zip = new ZipFile();
  const used = new Set<string>();
  for (const f of present) {
    // yazl lit le fichier sur disque en streaming au moment du flush.
    zip.addFile(storedFilePath(f.stored_name), uniqueName(f.original_name, used));
    incrementDownloadCount(f.id);
  }
  zip.end();

  // yazl type outputStream en NodeJS.ReadableStream ; au runtime c'est un
  // PassThrough (un Readable concret) → cast sûr pour Readable.toWeb.
  const out = zip.outputStream as unknown as Readable;
  // Filet de sécurité : si un fichier disparaît entre le stat et le flush, yazl
  // émet 'error' sur l'instance ZipFile → on coupe le flux au lieu de crasher.
  zip.on("error", (err) => out.destroy(err));
  const body = Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>;

  // Nom d'archive : <dossier>.zip (ASCII en repli + filename* UTF-8).
  const zipName = `${folder.name || "dossier"}.zip`;
  const fallback = zipName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
        zipName,
      )}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
