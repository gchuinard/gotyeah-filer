import { normalizeEmail } from "@/lib/email";

/**
 * Accès centralisé aux variables d'environnement.
 * Lecture paresseuse (au moment de la requête) pour ne pas dépendre de l'env
 * au moment du build.
 */

/** Emails admin (`ADMIN_EMAILS`, séparés par des virgules), normalisés. */
export function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map(normalizeEmail)
      .filter((email) => email.length > 0),
  );
}

/** Vrai si l'email fait partie des admins (normalisation des deux côtés). */
export function isAdminEmail(email: string): boolean {
  return getAdminEmails().has(normalizeEmail(email));
}

/** Secret de signature des sessions (`SESSION_SECRET`), encodé pour jose. */
export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET manquant ou trop court (≥ 16 caractères requis).",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Répertoire des données (fichiers + base SQLite). `DATA_DIR` (optionnel,
 * défaut `/data` = volume Docker). En dev on pointe vers un dossier local.
 */
export function getDataDir(): string {
  const dir = process.env.DATA_DIR;
  return dir && dir.length > 0 ? dir : "/data";
}

/** Taille maximale d'un upload, en octets (depuis `MAX_UPLOAD_MB`, défaut 1024). */
export function getMaxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB);
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : 1024;
  return Math.floor(safeMb * 1024 * 1024);
}
