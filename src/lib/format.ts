/** Taille lisible : « 2,4 Mo », « 812 Ko »… (base 1024, locale FR). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded.toLocaleString("fr-FR")} ${units[i]}`;
}

/** Date lisible FR : « 8 juin 2026, 14:32 ». */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
