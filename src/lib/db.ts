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
      folder_id     TEXT,
      download_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shares (
      token          TEXT PRIMARY KEY,
      file_id        TEXT,
      folder_id      TEXT,
      allowed_emails TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      -- Un partage vise EXACTEMENT un fichier OU un dossier (jamais les deux,
      -- jamais aucun) : XOR sur la présence de file_id / folder_id.
      CHECK ((file_id IS NOT NULL) <> (folder_id IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
  `);
  // NB : l'index sur shares.folder_id est créé APRÈS ensurePolymorphicShares,
  // car une base historique n'a pas encore cette colonne à ce stade.

  // Pour les bases créées avant l'ajout des dossiers : colonne idempotente.
  ensureColumn(db, "files", "folder_id", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);");

  // Compteur de téléchargements (ajouté après coup) : idempotent, défaut 0.
  ensureColumn(db, "files", "download_count", "INTEGER NOT NULL DEFAULT 0");

  // Note libre par fichier (ajoutée après coup) : idempotente, NULL par défaut.
  ensureColumn(db, "files", "note", "TEXT");

  // Partage de dossier (ajouté après coup) : la table `shares` historique a
  // `file_id NOT NULL` et pas de `folder_id`. SQLite ne sait pas relâcher un
  // NOT NULL par ALTER → on reconstruit la table (idempotent, legacy only).
  ensurePolymorphicShares(db);

  // À ce stade, shares.folder_id existe (création neuve OU reconstruction).
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_shares_folder_id ON shares(folder_id);",
  );

  return db;
}

/**
 * Met la table `shares` au format polymorphe (file_id nullable + folder_id).
 * Ne fait rien si le schéma est déjà à jour (bases neuves) ; sinon reconstruit
 * la table en conservant les partages de fichiers existants.
 */
function ensurePolymorphicShares(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(shares)").all() as {
    name: string;
    notnull: number;
  }[];
  const fileId = cols.find((c) => c.name === "file_id");
  const hasFolderId = cols.some((c) => c.name === "folder_id");
  // Déjà au bon format : file_id nullable ET colonne folder_id présente.
  if (fileId && fileId.notnull === 0 && hasFolderId) return;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE shares_new (
        token          TEXT PRIMARY KEY,
        file_id        TEXT,
        folder_id      TEXT,
        allowed_emails TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        CHECK ((file_id IS NOT NULL) <> (folder_id IS NOT NULL))
      );
      INSERT INTO shares_new (token, file_id, folder_id, allowed_emails, created_at)
        SELECT token, file_id, NULL, allowed_emails, created_at FROM shares;
      DROP TABLE shares;
      ALTER TABLE shares_new RENAME TO shares;
      CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
      CREATE INDEX IF NOT EXISTS idx_shares_folder_id ON shares(folder_id);
    `);
  })();
}

export function getDb(): Database.Database {
  if (!globalForDb.__filerDb) {
    globalForDb.__filerDb = createDb();
  }
  return globalForDb.__filerDb;
}
