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

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
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
  return AUDIO_MIME[e] ?? VIDEO_MIME[e] ?? mime ?? "application/octet-stream";
}
