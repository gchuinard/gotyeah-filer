import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";

export type ShareRow = {
  token: string;
  /** Cible fichier (exclusif avec folder_id). */
  file_id: string | null;
  /** Cible dossier (exclusif avec file_id). */
  folder_id: string | null;
  /** JSON array d'emails normalisés (vide pour un lien public). */
  allowed_emails: string;
  created_at: number;
  /** 1 = lien public : quiconque a le lien entre, sans saisir d'e-mail. */
  public: number;
  /** Fin de validité (ms), ou null = sans expiration. */
  expires_at: number | null;
};

/** Durées proposées pour un lien public, en jours (null = sans expiration). */
export const PUBLIC_LINK_DAYS = [1, 7, 30] as const;
export const DEFAULT_PUBLIC_LINK_DAYS = 7;

/** Partage tel que le reçoit l'UI admin. */
export type ShareDto = {
  token: string;
  emails: string[];
  created_at: number;
  public: boolean;
  expires_at: number | null;
  expired: boolean;
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
      `INSERT INTO shares (token, file_id, folder_id, allowed_emails, created_at, public, expires_at)
       VALUES (@token, @file_id, @folder_id, @allowed_emails, @created_at, @public, @expires_at)`,
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
    public: 0,
    expires_at: null,
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
    public: 0,
    expires_at: null,
  });
}

/**
 * Crée un LIEN PUBLIC vers un fichier ou un dossier : quiconque a le lien entre
 * directement, sans e-mail. Le secret reste le jeton (144 bits) ; révocable, et
 * à durée limitée si `days` est donné (null = sans expiration).
 */
export function createPublicShare(
  target: { fileId: string } | { folderId: string },
  days: number | null,
): ShareRow {
  const now = Date.now();
  return insertShare({
    token: generateToken(),
    file_id: "fileId" in target ? target.fileId : null,
    folder_id: "folderId" in target ? target.folderId : null,
    allowed_emails: "[]",
    created_at: now,
    public: 1,
    expires_at: days ? now + days * 24 * 60 * 60 * 1000 : null,
  });
}

/** Lit la durée demandée pour un lien public (corps JSON `{ days }`). Renvoie
 * les jours, null (sans expiration), ou undefined si la valeur est invalide. */
export function parsePublicLinkDays(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (raw === undefined) return DEFAULT_PUBLIC_LINK_DAYS;
  return (PUBLIC_LINK_DAYS as readonly unknown[]).includes(raw)
    ? (raw as number)
    : undefined;
}

/** Le partage a-t-il expiré ? */
export function isShareExpired(share: ShareRow, now: number = Date.now()): boolean {
  return share.expires_at != null && share.expires_at <= now;
}

/** Partage utilisable (existant ET non expiré), ou undefined. */
export function getActiveShare(token: string): ShareRow | undefined {
  const share = getShare(token);
  return share && !isShareExpired(share) ? share : undefined;
}

/** Forme envoyée à l'UI admin (liste des partages, réponse de création). */
export function toShareDto(share: ShareRow, now: number = Date.now()): ShareDto {
  return {
    token: share.token,
    emails: parseAllowedEmails(share),
    created_at: share.created_at,
    public: share.public === 1,
    expires_at: share.expires_at,
    expired: isShareExpired(share, now),
  };
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
