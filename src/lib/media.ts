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

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Vrai si le fichier est un audio (par MIME, sinon par extension connue). */
export function isAudio(mime: string | null, name: string): boolean {
  if (mime?.startsWith("audio/")) return true;
  return ext(name) in AUDIO_MIME;
}

/**
 * Content-Type à servir : le MIME stocké s'il est exploitable, sinon déduit de
 * l'extension pour les médias connus. Utile quand l'upload n'a pas fourni de
 * type fiable (certains .wav arrivent en `application/octet-stream`), ce qui
 * empêcherait la lecture inline (avec `nosniff`, le navigateur s'en remet au
 * Content-Type déclaré).
 */
export function mediaContentType(mime: string | null, name: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  return AUDIO_MIME[ext(name)] ?? mime ?? "application/octet-stream";
}
