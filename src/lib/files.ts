import { join } from "node:path";
import { rm } from "node:fs/promises";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/config";

export type FileRow = {
  id: string;
  stored_name: string;
  original_name: string;
  size: number;
  mime: string | null;
  created_at: number;
  /** Dossier de rangement, ou null à la racine. */
  folder_id: string | null;
};

/** Répertoire physique des fichiers stockés. */
export function filesDir(): string {
  return join(getDataDir(), "files");
}

/** Chemin physique d'un fichier à partir de son nom de stockage (uuid). */
export function storedFilePath(storedName: string): string {
  return join(filesDir(), storedName);
}

/** Tous les fichiers, du plus récent au plus ancien. */
export function listFiles(): FileRow[] {
  return getDb()
    .prepare("SELECT * FROM files ORDER BY created_at DESC")
    .all() as FileRow[];
}

/** Un fichier par son id, ou undefined. */
export function getFile(id: string): FileRow | undefined {
  return getDb().prepare("SELECT * FROM files WHERE id = ?").get(id) as
    | FileRow
    | undefined;
}

/** Enregistre un fichier en base. */
export function insertFile(row: FileRow): void {
  getDb()
    .prepare(
      `INSERT INTO files (id, stored_name, original_name, size, mime, created_at, folder_id)
       VALUES (@id, @stored_name, @original_name, @size, @mime, @created_at, @folder_id)`,
    )
    .run(row);
}

/** Déplace un fichier dans un dossier (ou à la racine si null). */
export function moveFile(id: string, folderId: string | null): boolean {
  return (
    getDb()
      .prepare("UPDATE files SET folder_id = ? WHERE id = ?")
      .run(folderId, id).changes > 0
  );
}

/**
 * Supprime un fichier : ses partages, sa ligne en base, et le fichier sur
 * disque. La partie base est transactionnelle.
 */
export async function deleteFileCompletely(id: string): Promise<boolean> {
  const file = getFile(id);
  if (!file) return false;

  const db = getDb();
  const tx = db.transaction((fileId: string) => {
    db.prepare("DELETE FROM shares WHERE file_id = ?").run(fileId);
    db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  });
  tx(id);

  await rm(storedFilePath(file.stored_name), { force: true });
  return true;
}
