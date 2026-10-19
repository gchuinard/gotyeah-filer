/** Nettoie le nom d'origine (affichage / Content-Disposition uniquement). */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || "fichier";
}
