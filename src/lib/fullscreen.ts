/* ---- Fullscreen API (avec repli webkit pour Safari/iPad) -------------------
 * Mutualisé par la lightbox (« mode projection ») et la fenêtre publique du
 * mode présentateur (`/admin/projection`).
 *
 * iOS Safari (iPhone) ne sait pas mettre un élément en plein écran : `fsEnabled`
 * renvoie alors `false` et l'appelant reste sur un simple overlay noir
 * (dégradation gracieuse). Sur desktop / Android, on passe en VRAI plein écran
 * immersif (hors du cadre du navigateur).
 *
 * À n'utiliser que côté client (les helpers touchent `document`). */
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};

const fsDoc = () => document as FsDocument;

export function fsActive(): boolean {
  return !!(document.fullscreenElement || fsDoc().webkitFullscreenElement);
}
export function fsEnabled(): boolean {
  return !!(document.fullscreenEnabled || fsDoc().webkitFullscreenEnabled);
}
export function enterFs(el: HTMLElement): Promise<void> {
  const fn =
    el.requestFullscreen?.bind(el) ??
    (el as FsElement).webkitRequestFullscreen?.bind(el);
  if (!fn) return Promise.resolve();
  try {
    return Promise.resolve(fn()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
export function exitFs(): Promise<void> {
  if (!fsActive()) return Promise.resolve();
  const fn =
    document.exitFullscreen?.bind(document) ??
    fsDoc().webkitExitFullscreen?.bind(document);
  if (!fn) return Promise.resolve();
  try {
    return Promise.resolve(fn()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
