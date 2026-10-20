import type { Stats } from "node:fs";

/**
 * Requêtes partielles HTTP (`Range` / `If-Range`, RFC 9110 §13-14) pour servir
 * des fichiers de plusieurs dizaines de Go : un téléchargement coupé reprend
 * là où il s'était arrêté (navigateur, `curl -C -`, gestionnaire de
 * téléchargement) au lieu de repartir de zéro.
 */

export type Validators = { etag: string; lastModified: string };

/** Validateurs FORTS du fichier sur disque (ETag façon nginx : taille et mtime
 * en hexadécimal). Ils changent dès que les octets changent — l'écrasement par
 * la retouche réécrit le fichier — donc une reprise ne peut jamais recoller
 * deux versions différentes. */
export function validators(st: Stats): Validators {
  return {
    etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
    lastModified: new Date(st.mtimeMs).toUTCString(),
  };
}

export type ByteRange =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

const NONE: ByteRange = { kind: "none" };

/**
 * Lit UNE plage `bytes=` : `a-b`, `a-` (jusqu'à la fin) ou `-n` (les n derniers
 * octets). Plusieurs plages ou une syntaxe inconnue → ignoré (réponse 200
 * complète, ce que la RFC autorise). Plage hors du fichier → 416.
 */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return NONE;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return NONE;

  if (!m[1]) {
    // Suffixe : les n derniers octets.
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n)) return NONE;
    if (n === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(m[1]);
  const last = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(last)) return NONE;
  if (start >= size || start > last) return { kind: "unsatisfiable" };
  return { kind: "range", start, end: Math.min(last, size - 1) };
}

/**
 * `If-Range` : la plage n'est honorée que si le fichier n'a pas changé depuis
 * le début du téléchargement (sinon on renvoie le fichier entier). ETag :
 * comparaison FORTE (un ETag faible `W/` ne vaut jamais) ; date : égalité à la
 * seconde près avec `Last-Modified`.
 */
export function ifRangeAllows(header: string | null, v: Validators): boolean {
  if (!header) return true;
  const value = header.trim();
  if (value.startsWith('"') || value.startsWith("W/")) return value === v.etag;
  const date = Date.parse(value);
  return !Number.isNaN(date) && date === Date.parse(v.lastModified);
}
