import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import {
  incrementDownloadCount,
  storedFilePath,
  type FileRow,
} from "@/lib/files";

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
 * Construit une Response .zip en streaming à partir d'une liste de fichiers,
 * après pré-vérification disque (on n'embarque que les blobs réellement
 * présents). Chaque fichier inclus compte comme un téléchargement.
 *
 * Renvoie `null` si aucun fichier n'est disponible (à l'appelant de répondre
 * 404). Le pré-stat + le handler d'erreur yazl (les erreurs sont émises sur
 * l'instance ZipFile, pas sur outputStream) évitent de crasher le process si
 * un blob disparaît.
 */
export async function zipFilesResponse(
  files: FileRow[],
  zipName: string,
): Promise<Response | null> {
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
  ).filter((f): f is FileRow => f !== null);

  if (present.length === 0) return null;

  const zip = new ZipFile();
  const used = new Set<string>();
  for (const f of present) {
    zip.addFile(storedFilePath(f.stored_name), uniqueName(f.original_name, used));
    incrementDownloadCount(f.id);
  }
  zip.end();

  // yazl type outputStream en NodeJS.ReadableStream ; au runtime c'est un
  // PassThrough (Readable concret) → cast sûr pour Readable.toWeb.
  const out = zip.outputStream as unknown as Readable;
  zip.on("error", (err) => out.destroy(err));
  const body = Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>;

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
