import { mkdirSync, renameSync } from "node:fs";
import { readdir, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { filesDir, insertFile, storedFilePath } from "@/lib/files";
import { getFolder } from "@/lib/folders";
import { UPLOAD_ID_RE } from "@/lib/upload-protocol";

/**
 * Upload PAR MORCEAUX, côté serveur (protocole : `src/lib/upload-protocol.ts`).
 *
 * Une session = une ligne `uploads` + un fichier partiel `/data/uploads/<id>.part`
 * sur le MÊME volume que `/data/files` (le `rename` final est donc atomique —
 * jamais `os.tmpdir()`, qui est l'overlay du conteneur : EXDEV, copie de 48 Go).
 * La position de reprise est la taille RÉELLE du `.part` (`stat`), jamais une
 * valeur mémorisée : elle survit à un redémarrage et ne peut pas mentir.
 *
 * Une fois complet, le partiel devient un fichier ordinaire dont l'id est celui
 * de la session (`finalizeUpload`) : le reste de l'app n'y voit aucune différence.
 */

/** Nettoie le nom d'origine (affichage / Content-Disposition uniquement). */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || "fichier";
}

export type UploadRow = {
  id: string;
  original_name: string;
  /** Taille totale annoncée à l'ouverture (octets). */
  size: number;
  mime: string | null;
  folder_id: string | null;
  /** `nom|taille|lastModified` : repère un nouvel essai du même fichier. */
  fingerprint: string | null;
  created_at: number;
  /** Dernière activité (création ou morceau reçu) : base de la purge. */
  updated_at: number;
};

/** Session sans activité depuis plus longtemps que ça → purgée. */
const STALE_UPLOAD_MS = 6 * 60 * 60 * 1000;
/** Partiel sans ligne en base plus vieux que ça → purgé (le délai couvre la
 * fenêtre entre la création du `.part` et celle de sa ligne). */
const ORPHAN_PART_MS = 10 * 60 * 1000;

/** Répertoire des fichiers partiels (même volume que `filesDir()`). */
export function uploadsDir(): string {
  return join(getDataDir(), "uploads");
}

/** Chemin du fichier partiel d'une session. `id` DOIT avoir été validé par
 * `UPLOAD_ID_RE` avant (il vient de l'URL). */
export function partPath(id: string): string {
  return join(uploadsDir(), `${id}.part`);
}

export function getUpload(id: string): UploadRow | undefined {
  return getDb().prepare("SELECT * FROM uploads WHERE id = ?").get(id) as
    | UploadRow
    | undefined;
}

export function createUploadRow(row: UploadRow): void {
  getDb()
    .prepare(
      `INSERT INTO uploads (id, original_name, size, mime, folder_id, fingerprint, created_at, updated_at)
       VALUES (@id, @original_name, @size, @mime, @folder_id, @fingerprint, @created_at, @updated_at)`,
    )
    .run(row);
}

export function touchUpload(id: string, now: number): void {
  getDb().prepare("UPDATE uploads SET updated_at = ? WHERE id = ?").run(now, id);
}

/** Abandonne une session : sa ligne (tout de suite, synchrone) puis son partiel. */
export async function discardUpload(id: string): Promise<void> {
  getDb().prepare("DELETE FROM uploads WHERE id = ?").run(id);
  await rm(partPath(id), { force: true });
}

/** Taille actuelle du partiel (= position de reprise), ou null s'il manque. */
export async function partSize(id: string): Promise<number | null> {
  try {
    return (await stat(partPath(id))).size;
  } catch {
    return null;
  }
}

// ─── Verrous ────────────────────────────────────────────────────────────────
// Un seul morceau à la fois par session : deux écritures en ajout sur le même
// partiel entrelaceraient leurs octets sans que rien ne le signale. Le verrou
// vit sur `globalThis` (comme la connexion SQLite) pour être PARTAGÉ entre les
// bundles de routes (`sessions` et `sessions/[id]`) et survivre au hot-reload.
// Volatile : un redémarrage le perd, et c'est voulu (aucune écriture ne survit
// au processus qui la faisait).

export type UploadLock = {
  /** Interrompt la lecture du morceau en cours (annulation). */
  ac: AbortController;
  /** Annulation demandée pendant l'écriture : le PUT nettoie en sortant. */
  cancelled: boolean;
};

const globalForUploads = globalThis as unknown as {
  __filerUploadLocks?: Map<string, UploadLock>;
  __filerUploadInitChain?: Promise<unknown>;
};

/**
 * Exécute les ouvertures de session UNE PAR UNE. Entre la mesure de la place
 * libre et l'insertion de la ligne (qui vaut réservation), il y a des await :
 * deux ouvertures simultanées (glisser-déposer de plusieurs fichiers) verraient
 * sinon la même place libre et pourraient, ensemble, remplir le disque. Une
 * ouverture dure quelques ms : la sérialisation ne coûte rien.
 */
export function serializeUploadInit<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalForUploads.__filerUploadInitChain ?? Promise.resolve();
  const run = prev.then(fn, fn);
  globalForUploads.__filerUploadInitChain = run.catch(() => {});
  return run;
}

function locks(): Map<string, UploadLock> {
  globalForUploads.__filerUploadLocks ??= new Map();
  return globalForUploads.__filerUploadLocks;
}

/** Prend le verrou d'une session, ou null s'il est déjà pris. */
export function acquireUploadLock(id: string): UploadLock | null {
  if (locks().has(id)) return null;
  const lock: UploadLock = { ac: new AbortController(), cancelled: false };
  locks().set(id, lock);
  return lock;
}

export function releaseUploadLock(id: string, lock: UploadLock): void {
  if (locks().get(id) === lock) locks().delete(id);
}

export function getUploadLock(id: string): UploadLock | undefined {
  return locks().get(id);
}

// ─── Purge & place disque ───────────────────────────────────────────────────

/**
 * Supprime les sessions inactives depuis plus de 6 h (non verrouillées) et les
 * partiels orphelins (sans ligne). Appelée à chaque ouverture de session : pas
 * de tâche de fond à maintenir, et c'est justement quand on va consommer du
 * disque qu'il faut en récupérer.
 */
export async function purgeStaleUploads(now: number): Promise<void> {
  const stale = getDb()
    .prepare("SELECT id FROM uploads WHERE updated_at < ?")
    .all(now - STALE_UPLOAD_MS) as { id: string }[];
  for (const { id } of stale) {
    // Contrôle du verrou + suppression de la ligne sont synchrones (dans
    // `discardUpload`, avant son premier await) : pas de course avec un PUT.
    if (!locks().has(id)) await discardUpload(id);
  }

  let names: string[];
  try {
    names = await readdir(uploadsDir());
  } catch {
    return; // Pas encore de répertoire : rien à purger.
  }
  for (const name of names) {
    const id = name.endsWith(".part") ? name.slice(0, -".part".length) : "";
    // On ne touche qu'à NOS partiels (nom = uuid.part).
    if (!UPLOAD_ID_RE.test(id) || getUpload(id) || locks().has(id)) continue;
    try {
      const s = await stat(partPath(id));
      if (now - s.mtimeMs > ORPHAN_PART_MS && !getUpload(id)) {
        await rm(partPath(id), { force: true });
      }
    } catch {
      // Disparu entre-temps : rien à faire.
    }
  }
}

/** Abandonne les envois précédents du même fichier (même empreinte) qui ne
 * sont pas en cours d'écriture : un essai interrompu de 48 Go bloquerait sinon
 * le disque pour le nouvel essai jusqu'à la purge. */
export async function discardSameFingerprint(fingerprint: string): Promise<void> {
  const rows = getDb()
    .prepare("SELECT id FROM uploads WHERE fingerprint = ?")
    .all(fingerprint) as { id: string }[];
  for (const { id } of rows) {
    if (!locks().has(id)) await discardUpload(id);
  }
}

/** Place libre utilisable sur le volume de données (octets), ou null si on ne
 * sait pas la mesurer. `bavail` (et non `bfree`) : le processus ne tourne pas
 * en root, les blocs réservés lui sont interdits. */
export async function freeBytes(): Promise<number | null> {
  try {
    const s = await statfs(getDataDir());
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Octets encore dus aux sessions ouvertes (taille annoncée − déjà reçu) : la
 * place qu'elles vont consommer, à réserver avant d'en accepter une nouvelle. */
export async function pendingUploadBytes(): Promise<number> {
  const rows = getDb().prepare("SELECT id, size FROM uploads").all() as {
    id: string;
    size: number;
  }[];
  let total = 0;
  for (const { id, size } of rows) {
    total += Math.max(0, size - ((await partSize(id)) ?? 0));
  }
  return total;
}

// ─── Finalisation ───────────────────────────────────────────────────────────

/**
 * Transforme un partiel complet en fichier ordinaire : ligne `files` (id =
 * stored_name = id de session), suppression de la ligne `uploads`, et `rename`
 * du partiel vers `/data/files/<id>` — le tout dans UNE transaction : si le
 * rename échoue, rien n'est enregistré. Synchrone de bout en bout, donc rien ne
 * peut s'intercaler (annulation, purge). Le dossier est revérifié : supprimé
 * pendant l'envoi → racine, comme l'upload d'un bloc.
 */
export function finalizeUpload(row: UploadRow, now: number): void {
  const db = getDb();
  const folderId = row.folder_id && getFolder(row.folder_id) ? row.folder_id : null;
  db.transaction(() => {
    insertFile({
      id: row.id,
      stored_name: row.id,
      original_name: row.original_name,
      size: row.size,
      mime: row.mime,
      created_at: now,
      folder_id: folderId,
    });
    db.prepare("DELETE FROM uploads WHERE id = ?").run(row.id);
    mkdirSync(filesDir(), { recursive: true });
    renameSync(partPath(row.id), storedFilePath(row.id));
  })();
}
