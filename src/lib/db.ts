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
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      token          TEXT PRIMARY KEY,
      file_id        TEXT NOT NULL,
      allowed_emails TEXT NOT NULL,
      created_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb.__filerDb) {
    globalForDb.__filerDb = createDb();
  }
  return globalForDb.__filerDb;
}
