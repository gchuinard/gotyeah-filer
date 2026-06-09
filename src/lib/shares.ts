import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";

export type ShareRow = {
  token: string;
  /** Cible fichier (exclusif avec folder_id). */
  file_id: string | null;
  /** Cible dossier (exclusif avec file_id). */
  folder_id: string | null;
  /** JSON array d'emails normalisés. */
  allowed_emails: string;
  created_at: number;
};

/** Token de partage : 24 caractères URL-safe (le vrai secret d'un partage). */
function generateToken(): string {
  return randomBytes(18).toString("base64url");
}

/** Normalise + déduplique une liste d'emails (vides retirés). */
export function normalizeEmails(emails: string[]): string[] {
  const set = new Set<string>();
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (email) set.add(email);
  }
  return [...set];
}

/** Insère une ligne de partage (cible fichier OU dossier — cf. CHECK SQL). */
function insertShare(row: ShareRow): ShareRow {
  getDb()
    .prepare(
      `INSERT INTO shares (token, file_id, folder_id, allowed_emails, created_at)
       VALUES (@token, @file_id, @folder_id, @allowed_emails, @created_at)`,
    )
    .run(row);
  return row;
}

/** Crée un partage pour un fichier avec une liste d'emails autorisés. */
export function createShare(fileId: string, emails: string[]): ShareRow {
  return insertShare({
    token: generateToken(),
    file_id: fileId,
    folder_id: null,
    allowed_emails: JSON.stringify(normalizeEmails(emails)),
    created_at: Date.now(),
  });
}

/** Crée un partage pour un dossier entier (tous ses fichiers, « vivant »). */
export function createFolderShare(folderId: string, emails: string[]): ShareRow {
  return insertShare({
    token: generateToken(),
    file_id: null,
    folder_id: folderId,
    allowed_emails: JSON.stringify(normalizeEmails(emails)),
    created_at: Date.now(),
  });
}

export function getShare(token: string): ShareRow | undefined {
  return getDb().prepare("SELECT * FROM shares WHERE token = ?").get(token) as
    | ShareRow
    | undefined;
}

export function listShares(): ShareRow[] {
  return getDb()
    .prepare("SELECT * FROM shares ORDER BY created_at DESC")
    .all() as ShareRow[];
}

export function deleteShare(token: string): boolean {
  return getDb().prepare("DELETE FROM shares WHERE token = ?").run(token).changes > 0;
}

/** Emails autorisés d'un partage, parsés depuis le JSON. */
export function parseAllowedEmails(share: ShareRow): string[] {
  try {
    const arr = JSON.parse(share.allowed_emails);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Vrai si l'email (normalisé) figure dans la liste autorisée du partage. */
export function shareAllowsEmail(share: ShareRow, email: string): boolean {
  return parseAllowedEmails(share).includes(normalizeEmail(email));
}
