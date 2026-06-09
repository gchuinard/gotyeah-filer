/** Types audio lisibles dans le navigateur (extension -> MIME). */
const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
};

/** Types vidéo lisibles dans le navigateur (extension -> MIME). */
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
};

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
]);

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Vrai si le fichier est une image (par MIME, sinon par extension connue). */
export function isImage(mime: string | null, name: string): boolean {
  if (mime?.startsWith("image/")) return true;
  return IMAGE_EXT.has(ext(name));
}

/** Vrai si le fichier est un audio (par MIME, sinon par extension connue). */
export function isAudio(mime: string | null, name: string): boolean {
  if (mime?.startsWith("audio/")) return true;
  return ext(name) in AUDIO_MIME;
}

/** Vrai si le fichier est une vidéo (par MIME, sinon par extension connue). */
export function isVideo(mime: string | null, name: string): boolean {
  if (mime?.startsWith("video/")) return true;
  return ext(name) in VIDEO_MIME;
}

/** Vrai si le fichier est un PDF. */
export function isPdf(mime: string | null, name: string): boolean {
  return mime === "application/pdf" || ext(name) === "pdf";
}

/** Catégorie de fichier pour le filtre (image / audio / vidéo / autre). */
export type FileCategory = "image" | "audio" | "video" | "other";
export function fileCategory(mime: string | null, name: string): FileCategory {
  if (isImage(mime, name)) return "image";
  if (isAudio(mime, name)) return "audio";
  if (isVideo(mime, name)) return "video";
  return "other";
}

/**
 * Content-Type à servir : le MIME stocké s'il est exploitable, sinon déduit de
 * l'extension pour les médias connus. Utile quand l'upload n'a pas fourni de
 * type fiable (certains .wav/.mp4 arrivent en `application/octet-stream`), ce
 * qui empêcherait la lecture inline (avec `nosniff`, le navigateur s'en remet
 * au Content-Type déclaré).
 */
export function mediaContentType(mime: string | null, name: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  const e = ext(name);
  if (AUDIO_MIME[e]) return AUDIO_MIME[e];
  if (VIDEO_MIME[e]) return VIDEO_MIME[e];
  if (e === "pdf") return "application/pdf";
  return mime ?? "application/octet-stream";
}

/**
 * Peut-on servir ce fichier EN LIGNE (Content-Disposition: inline) sans risque
 * d'exécution de contenu actif sur notre origine ? On autorise uniquement les
 * types « inertes » qu'on prévisualise : image (hors SVG, qui peut porter du
 * script), audio, vidéo, PDF. Tout le reste (html, svg, …) est forcé en
 * téléchargement même si `?inline=1` est demandé.
 */
export function isInlineSafe(mime: string | null, name: string): boolean {
  const ct = mediaContentType(mime, name);
  if (ct.startsWith("audio/") || ct.startsWith("video/")) return true;
  if (ct === "application/pdf") return true;
  if (ct.startsWith("image/") && ct !== "image/svg+xml") return true;
  return false;
}
