import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/config";

/**
 * Connexion SQLite unique (better-sqlite3). Le schéma est créé au premier
 * accès s'il est absent — pas de migrations, pas d'ORM (cf. CLAUDE.md).
 *
 * On garde l'instance sur `globalThis` pour survivre au hot-reload en dev
 * (sinon chaque rechargement rouvre une connexion).
 */

const globalForDb = globalThis as unknown as {
  __filerDb?: Database.Database;
};

/**
 * Ajoute une colonne si elle est absente (évolution de schéma sans framework).
 * ⚠️ `table`/`column`/`type` sont interpolés dans le SQL (SQLite n'accepte pas
 * de bind pour les identifiants) : ne JAMAIS y passer d'entrée utilisateur,
 * uniquement des littéraux constants du code.
 */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function createDb(): Database.Database {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });

  const db = new Database(join(dir, "filer.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      stored_name   TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size          INTEGER NOT NULL,
      mime          TEXT,
      created_at    INTEGER NOT NULL,
      folder_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS shares (
      token          TEXT PRIMARY KEY,
      file_id        TEXT NOT NULL,
      allowed_emails TEXT NOT NULL,
      created_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
  `);

  // Pour les bases créées avant l'ajout des dossiers : colonne idempotente.
  ensureColumn(db, "files", "folder_id", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);");

  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb.__filerDb) {
    globalForDb.__filerDb = createDb();
  }
  return globalForDb.__filerDb;
}
