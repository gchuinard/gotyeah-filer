import type { NextRequest } from "next/server";
import { open, type FileHandle } from "node:fs/promises";
import { getSession } from "@/lib/auth";
import { getFile } from "@/lib/files";
import {
  UPLOAD_CHUNK_HEADER,
  UPLOAD_ID_RE,
  UPLOAD_MAX_CHUNK_BYTES,
  UPLOAD_OFFSET_HEADER,
  chunkCount,
  chunkLength,
  type UploadStatus,
} from "@/lib/upload-protocol";
import {
  acquireUploadLock,
  beginChunkWrite,
  cancelUploadWrites,
  discardUpload,
  endChunkWrite,
  finalizeUpload,
  getUpload,
  isUploadBusy,
  partPath,
  partSize,
  receivedChunkCount,
  receivedChunkList,
  recordChunk,
  recoverFinalized,
  releaseUploadLock,
  touchUpload,
  type UploadRow,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Morceau dont le corps n'avance plus pendant ce délai → on rend la main
 * (sinon une requête « zombie » garderait le verrou jusqu'aux 300 s de Node). */
const IDLE_TIMEOUT_MS = 60_000;

type Params = { params: Promise<{ id: string }> };

function json(data: unknown, status: number): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Admin + id bien formé (AVANT toute construction de chemin), sinon la réponse
 * d'erreur à renvoyer telle quelle. */
async function guard(params: Params["params"]): Promise<string | Response> {
  const session = await getSession();
  if (session?.role !== "admin") return json({ error: "Accès refusé." }, 403);
  const { id } = await params;
  if (!UPLOAD_ID_RE.test(id)) return json({ error: "Envoi introuvable." }, 404);
  return id;
}

/** Envoi déjà finalisé (le fichier porte l'id de la session) → état « terminé ».
 * Rend la fin IDEMPOTENTE : si la réponse du dernier morceau se perd, le client
 * qui relit l'état (ou renvoie le morceau) apprend que c'est fini. */
function doneStatus(id: string): Response | null {
  const file = getFile(id);
  if (!file) return null;
  const status: UploadStatus = { offset: file.size, size: file.size, done: true };
  return json(status, 200);
}

function notFound(): Response {
  return json({ error: "Envoi introuvable (annulé ou expiré)." }, 404);
}

/** État d'un envoi : la position fait foi pour reprendre après un échec. */
export async function GET(request: NextRequest, { params }: Params) {
  const id = await guard(params);
  if (id instanceof Response) return id;

  const done = doneStatus(id);
  if (done) return done;
  const row = getUpload(id);
  if (!row) return notFound();

  if (row.chunk_size != null) return json(parallelStatus(row, request), 200);

  const offset = await partSize(id);
  if (offset === null) {
    // Finalisé pendant le stat (le partiel vient d'être renommé) ?
    return doneStatus(id) ?? notFound();
  }
  const status: UploadStatus = {
    offset,
    size: row.size,
    done: false,
    busy: isUploadBusy(id),
  };
  return json(status, 200);
}

/** État d'un envoi en mode parallèle : morceaux reçus (et leur liste avec
 * `?detail=1`, pour reprendre après une erreur sans renvoyer tout le fichier). */
function parallelStatus(row: UploadRow, request: NextRequest | null): UploadStatus {
  const received = receivedChunkCount(row.id);
  return {
    offset: Math.min(row.size, received * (row.chunk_size as number)),
    size: row.size,
    done: false,
    busy: isUploadBusy(row.id),
    received,
    ...(request?.nextUrl.searchParams.has("detail")
      ? { receivedChunks: receivedChunkList(row.id) }
      : {}),
  };
}

/** Lecture d'un morceau du corps, bornée par un délai d'inactivité et
 * interruptible (annulation / client parti). */
function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("ABORTED"));
      return;
    }
    const onAbort = () => reject(new Error("ABORTED"));
    const timer = setTimeout(() => reject(new Error("IDLE")), IDLE_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function writeAll(fh: FileHandle, buf: Uint8Array): Promise<void> {
  let done = 0;
  while (done < buf.byteLength) {
    const { bytesWritten } = await fh.write(buf, done, buf.byteLength - done);
    done += bytesWritten;
  }
}

type Failure = "too_large" | "aborted" | "idle" | "nospace" | "io" | "missing";

/**
 * Ajoute un morceau (corps brut) à la fin du partiel. `x-upload-offset` doit
 * égaler la taille actuelle du partiel (409 sinon, avec la bonne position).
 * Les octets reçus sont conservés même si la requête échoue en route (préfixe
 * valide : TCP/TLS ne livrent rien de corrompu) — la position réelle est
 * relue par `stat` APRÈS fermeture du fichier, seule source de vérité. Quand la
 * taille annoncée est atteinte, le fichier est finalisé dans la foulée.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const id = await guard(params);
  if (id instanceof Response) return id;

  const done = doneStatus(id);
  if (done) return done;

  const chunkHeader = request.headers.get(UPLOAD_CHUNK_HEADER);
  if (chunkHeader !== null) return putChunk(request, id, chunkHeader);

  const offsetHeader = request.headers.get(UPLOAD_OFFSET_HEADER) ?? "";
  const offset = /^\d{1,16}$/.test(offsetHeader) ? Number(offsetHeader) : NaN;
  if (!Number.isSafeInteger(offset)) {
    return json({ error: "Position d'envoi invalide." }, 400);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > UPLOAD_MAX_CHUNK_BYTES) {
    return json({ error: "Morceau trop volumineux." }, 413);
  }

  // Verrou puis ligne : deux opérations synchrones, donc atomiques vis-à-vis de
  // la purge et de l'annulation (qui ne touchent pas une session verrouillée).
  const lock = acquireUploadLock(id);
  if (!lock) {
    return json({ error: "Un morceau est déjà en cours d'envoi." }, 423);
  }
  try {
    const row = getUpload(id);
    if (!row) return doneStatus(id) ?? notFound();
    if (row.chunk_size != null) {
      return json({ error: "Envoi en mode parallèle : morceaux numérotés attendus." }, 400);
    }

    const current = await partSize(id);
    if (lock.cancelled) {
      // DELETE arrivé pendant le stat : il a répondu 202, à nous de nettoyer.
      await discardUpload(id);
      return json({ error: "Envoi annulé." }, 410);
    }
    if (current === null) {
      // Finalisation interrompue par une coupure (cf. recoverFinalized) ?
      if (recoverFinalized(row, Date.now())) {
        const status: UploadStatus = { offset: row.size, size: row.size, done: true };
        return json(status, 200);
      }
      await discardUpload(id);
      return notFound();
    }
    if (offset !== current) {
      const status: UploadStatus = {
        offset: current,
        size: row.size,
        done: false,
        error: "Position désynchronisée.",
      };
      return json(status, 409);
    }

    const cap = Math.min(UPLOAD_MAX_CHUNK_BYTES, row.size - current);
    let written = 0;
    let failure: Failure | null = null;

    if (request.body) {
      const signal = AbortSignal.any([request.signal, lock.ac.signal]);
      const reader = request.body.getReader();
      let fh: FileHandle | null = null;
      try {
        fh = await open(partPath(id), "a");
        for (;;) {
          const { done: end, value } = await readChunk(reader, signal);
          if (end) break;
          if (!value || value.byteLength === 0) continue;
          if (written + value.byteLength > cap) {
            failure = "too_large";
            break;
          }
          await writeAll(fh, value);
          written += value.byteLength;
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        const message = err instanceof Error ? err.message : "";
        failure =
          code === "ENOSPC"
            ? "nospace"
            : message === "IDLE"
              ? "idle"
              : message === "ABORTED" || lock.ac.signal.aborted
                ? "aborted"
                : "io";
      } finally {
        // Fermeture AVANT de relâcher le verrou : sinon un nouvel essai
        // pourrait ouvrir un second descripteur en ajout pendant que celui-ci
        // vide encore ses écritures.
        await fh?.close().catch(() => {});
        if (failure) reader.cancel().catch(() => {});
      }
    }

    const after = await partSize(id);
    const now = Date.now();

    if (lock.cancelled) {
      await discardUpload(id);
      return json({ error: "Envoi annulé." }, 410);
    }
    if (after === null) {
      await discardUpload(id);
      return notFound();
    }
    if (after > row.size) {
      // Ne devrait jamais arriver (plafond ci-dessus) : partiel inutilisable.
      await discardUpload(id);
      return json({ error: "Envoi corrompu, recommence." }, 500);
    }
    if (after === row.size) {
      try {
        finalizeUpload(row, now);
      } catch {
        return json({ error: "Échec de l'enregistrement du fichier." }, 500);
      }
      const status: UploadStatus = { offset: after, size: row.size, done: true };
      return json(status, 200);
    }

    touchUpload(id, now);
    if (!failure && declared && written < declared) {
      // Corps plus court qu'annoncé sans erreur : un intermédiaire a tronqué.
      // Le client repartira de la position renvoyée, mais on veut le savoir.
      console.warn(
        `[upload] ${id} : morceau tronqué (${written}/${declared} octets reçus)`,
      );
    }

    const status: UploadStatus = { offset: after, size: row.size, done: false };
    switch (failure) {
      case "nospace":
        return json({ ...status, error: "Disque plein côté serveur." }, 507);
      case "too_large":
        return json({ ...status, error: "Morceau trop volumineux." }, 413);
      case "idle":
        return json({ ...status, error: "Morceau interrompu (inactivité)." }, 408);
      case "aborted":
      case "io":
        return json({ ...status, error: "Morceau interrompu." }, 500);
      default:
        return json(status, 200);
    }
  } finally {
    releaseUploadLock(id, lock);
  }
}

/** Écrit tout `buf` à la position `position` du fichier (écriture positionnelle). */
async function writeAllAt(
  fh: FileHandle,
  buf: Uint8Array,
  position: number,
): Promise<void> {
  let done = 0;
  while (done < buf.byteLength) {
    const { bytesWritten } = await fh.write(
      buf,
      done,
      buf.byteLength - done,
      position + done,
    );
    done += bytesWritten;
  }
}

/**
 * Mode PARALLÈLE : écrit le morceau numéro `x-upload-chunk` À SA PLACE dans le
 * partiel. Plusieurs morceaux d'une même session s'écrivent en même temps sans
 * verrou : chacun a sa plage, et renvoyer un morceau réécrit les mêmes octets au
 * même endroit (idempotent). Le morceau n'est noté reçu (`upload_chunks`) que
 * s'il est arrivé EN ENTIER et le fichier refermé ; un morceau incomplet n'est
 * pas noté, le client le renverra en entier. Quand tous les morceaux sont notés,
 * le fichier est finalisé dans la foulée — le tout dans un bloc synchrone après
 * le dernier await, donc un seul PUT peut finaliser.
 */
async function putChunk(
  request: NextRequest,
  id: string,
  chunkHeader: string,
): Promise<Response> {
  const index = /^\d{1,9}$/.test(chunkHeader) ? Number(chunkHeader) : NaN;
  if (!Number.isSafeInteger(index)) {
    return json({ error: "Numéro de morceau invalide." }, 400);
  }
  const row = getUpload(id);
  if (!row) return doneStatus(id) ?? notFound();
  if (row.chunk_size == null) {
    return json({ error: "Envoi en mode séquentiel : position attendue." }, 400);
  }
  const chunkSize = row.chunk_size;
  const total = chunkCount(row.size, chunkSize);
  if (index >= total) {
    return json({ error: "Numéro de morceau hors du fichier." }, 400);
  }
  const expected = chunkLength(index, row.size, chunkSize);
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) !== expected) {
    return json({ error: "Taille de morceau inattendue." }, 400);
  }

  const writer = beginChunkWrite(id);
  if (!writer) return json({ error: "Envoi annulé." }, 410);
  try {
    let written = 0;
    let failure: Failure | null = null;

    if (request.body) {
      const signal = AbortSignal.any([request.signal, writer.ac.signal]);
      const reader = request.body.getReader();
      let fh: FileHandle | null = null;
      try {
        // Le partiel existe depuis l'ouverture (`wx`) : écriture positionnelle,
        // les plages encore vides restent des trous jusqu'à leur morceau.
        fh = await open(partPath(id), "r+");
        for (;;) {
          const { done: end, value } = await readChunk(reader, signal);
          if (end) break;
          if (!value || value.byteLength === 0) continue;
          if (written + value.byteLength > expected) {
            failure = "too_large";
            break;
          }
          await writeAllAt(fh, value, index * chunkSize + written);
          written += value.byteLength;
        }
        // Octets sur disque AVANT de noter le morceau reçu (cf. uploads.ts) ;
        // un échec ici → morceau non noté, le client le renverra.
        if (!failure && written === expected) await fh.datasync();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        const message = err instanceof Error ? err.message : "";
        failure =
          code === "ENOSPC"
            ? "nospace"
            : code === "ENOENT" && !fh
              ? "missing"
              : message === "IDLE"
                ? "idle"
                : message === "ABORTED" || writer.ac.signal.aborted
                  ? "aborted"
                  : "io";
      } finally {
        await fh?.close().catch(() => {});
        if (failure) reader.cancel().catch(() => {});
      }
    }

    // ── Bloc synchrone (aucun await jusqu'à la réponse, hors annulation) ──
    if (writer.state.cancelled) {
      await discardUpload(id);
      return json({ error: "Envoi annulé." }, 410);
    }
    const current = getUpload(id);
    if (!current) return doneStatus(id) ?? notFound();
    const now = Date.now();
    if (failure === "missing") {
      // Partiel disparu : soit une finalisation interrompue par une coupure
      // (fichier complet déjà à sa place → on la termine), soit une session
      // inutilisable (supprimé à la main…) → 404 plutôt que des réessais sans fin.
      if (receivedChunkCount(id) === total && recoverFinalized(current, now)) {
        const status: UploadStatus = {
          offset: current.size,
          size: current.size,
          done: true,
          received: total,
        };
        return json(status, 200);
      }
      await discardUpload(id);
      return notFound();
    }

    if (failure || written !== expected) {
      touchUpload(id, now);
      const status: UploadStatus = {
        ...parallelStatus(current, null),
        error:
          failure === "nospace"
            ? "Disque plein côté serveur."
            : failure === "too_large"
              ? "Morceau trop volumineux."
              : failure === "idle"
                ? "Morceau interrompu (inactivité)."
                : "Morceau incomplet.",
      };
      const code =
        failure === "nospace" ? 507 : failure === "too_large" ? 413 : failure === "idle" ? 408 : 500;
      return json(status, code);
    }

    recordChunk(id, index);
    touchUpload(id, now);
    const received = receivedChunkCount(id);
    if (received === total) {
      try {
        finalizeUpload(current, now);
      } catch {
        return json({ error: "Échec de l'enregistrement du fichier." }, 500);
      }
      const status: UploadStatus = {
        offset: current.size,
        size: current.size,
        done: true,
        received,
      };
      return json(status, 200);
    }
    return json(parallelStatus(current, null), 200);
  } finally {
    endChunkWrite(id, writer.ac);
  }
}

/**
 * Annule un envoi : supprime la session et son partiel. Si un morceau est en
 * cours d'écriture, on le signale (drapeau + abort) et c'est le PUT qui nettoie
 * en sortant, une fois son fichier fermé (202). Un envoi déjà finalisé n'est
 * PAS touché (409) — supprimer le fichier passe par `DELETE /api/files/<id>`.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const id = await guard(params);
  if (id instanceof Response) return id;

  if (getFile(id)) {
    return json({ error: "Envoi déjà terminé.", done: true }, 409);
  }
  // Écriture(s) en cours : drapeau + abort, c'est le PUT qui nettoie (202).
  if (cancelUploadWrites(id)) return new Response(null, { status: 202 });
  await discardUpload(id);
  return new Response(null, { status: 204 });
}
