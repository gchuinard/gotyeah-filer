import { getDb } from "@/lib/db";

export type FolderRow = {
  id: string;
  name: string;
  created_at: number;
};

/** Nettoie/borne un nom de dossier. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 100);
}

export function listFolders(): FolderRow[] {
  return getDb()
    .prepare("SELECT * FROM folders ORDER BY name COLLATE NOCASE ASC")
    .all() as FolderRow[];
}

export function getFolder(id: string): FolderRow | undefined {
  return getDb().prepare("SELECT * FROM folders WHERE id = ?").get(id) as
    | FolderRow
    | undefined;
}

export function createFolder(name: string): FolderRow {
  const row: FolderRow = {
    id: crypto.randomUUID(),
    name: cleanName(name),
    created_at: Date.now(),
  };
  getDb()
    .prepare("INSERT INTO folders (id, name, created_at) VALUES (@id, @name, @created_at)")
    .run(row);
  return row;
}

export function renameFolder(id: string, name: string): boolean {
  return (
    getDb()
      .prepare("UPDATE folders SET name = ? WHERE id = ?")
      .run(cleanName(name), id).changes > 0
  );
}

/**
 * Supprime un dossier ; ses fichiers repassent à la racine (folder_id = NULL)
 * et ses partages de dossier sont révoqués. Transactionnel.
 */
export function deleteFolder(id: string): boolean {
  const db = getDb();
  const tx = db.transaction((folderId: string) => {
    db.prepare("DELETE FROM shares WHERE folder_id = ?").run(folderId);
    db.prepare("UPDATE files SET folder_id = NULL WHERE folder_id = ?").run(folderId);
    return db.prepare("DELETE FROM folders WHERE id = ?").run(folderId).changes;
  });
  return tx(id) > 0;
}
