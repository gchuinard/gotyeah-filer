"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isAudio, isPdf, isVideo } from "@/lib/media";
import { fsActive, fsEnabled, enterFs, exitFs } from "@/lib/fullscreen";
import { FadeImage } from "@/components/fade-image";

type LightboxFile = {
  id: string;
  original_name: string;
  mime: string | null;
};

/* Le plein écran (Fullscreen API + repli webkit Safari/iPad) et `FadeImage`
 * sont mutualisés — cf. `@/lib/fullscreen` et `@/components/fade-image` — et
 * réutilisés par la fenêtre publique du mode présentateur (`/admin/projection`). */

/**
 * Aperçu plein écran d'un fichier (« mode projection »). À l'ouverture, on tente
 * le VRAI plein écran immersif (Fullscreen API) ; à défaut on reste sur un
 * overlay noir. Flèches = fichier précédent/suivant ; `F` ou le bouton = (re)passer
 * en plein écran ; Échap / Entrée / Espace / clic sur le fond = quitter. Sortir du
 * plein écran réel (Échap, UI du navigateur) quitte la projection.
 */
export function Lightbox({
  file,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  srcMap,
}: {
  file: LightboxFile;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /**
   * Cache id → object URL d'images préchargées (« mode hors-ligne »). Si l'image
   * courante y figure, on l'affiche depuis le blob local → la navigation ne
   * touche pas le réseau (pas de 404 en plein spectacle). Sinon repli réseau.
   */
  srcMap?: Map<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  const [fsSupported] = useState(
    () => typeof document !== "undefined" && fsEnabled(),
  );
  // Élément qui avait le focus avant l'ouverture, pour le restaurer à la
  // fermeture (capté au render, donc AVANT que `autoFocus` ne le déplace).
  const [prevFocus] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null,
  );

  // Callbacks toujours frais sans re-souscrire les listeners à chaque render
  // du parent (évite le churn add/removeEventListener et les closures obsolètes).
  const handlers = useRef({ onPrev, onNext, onClose });
  useEffect(() => {
    handlers.current = { onPrev, onNext, onClose };
  });

  // Le composant est-il encore monté ? Garde les effets asynchrones (Promise de
  // la Fullscreen API) de toucher un composant démonté.
  const aliveRef = useRef(true);
  // A-t-on réussi à entrer en vrai plein écran ? Si oui, en sortir ferme la projection.
  const enteredFsRef = useRef(false);

  const goFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el || fsActive()) return;
    void enterFs(el).then(() => {
      // Fermé avant la fin de la transition → ressortir (pas de plein écran orphelin).
      if (!aliveRef.current) void exitFs();
    });
  }, []);

  // À l'ouverture : tenter le vrai plein écran. `useLayoutEffect` → l'appel part
  // SYNCHRONEMENT dans le flush de l'évènement (clic / touche) qui a ouvert la
  // lightbox, donc à l'intérieur de l'« activation utilisateur » exigée par la
  // spec Fullscreen (sinon Firefox/Safari refusent). Repli garanti : le bouton
  // « Plein écran » (geste direct sur un élément déjà monté).
  useLayoutEffect(() => {
    aliveRef.current = true;
    if (fsSupported) goFullscreen();
    return () => {
      aliveRef.current = false;
      void exitFs();
    };
  }, [fsSupported, goFullscreen]);

  // Suit l'état plein écran ; en SORTIR (Échap, UI du navigateur) ferme la projection.
  useEffect(() => {
    function onFsChange() {
      const active = fsActive();
      if (aliveRef.current) setIsFs(active);
      if (active) enteredFsRef.current = true;
      else if (enteredFsRef.current) {
        enteredFsRef.current = false;
        handlers.current.onClose();
      }
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // En vrai plein écran, le navigateur intercepte Échap pour en sortir
        // (→ fullscreenchange → fermeture). Sinon, on ferme nous-mêmes.
        if (!fsActive()) {
          e.preventDefault();
          handlers.current.onClose();
        }
      } else if (e.key === "Enter" || e.key === " ") {
        // Fermeture immédiate ; le démontage sort du plein écran tout seul.
        e.preventDefault();
        handlers.current.onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        handlers.current.onNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        handlers.current.onPrev();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        goFullscreen();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goFullscreen]);

  // Restaure le focus à la fermeture (a11y modale).
  useEffect(() => {
    return () => prevFocus?.focus?.();
  }, [prevFocus]);

  // Blob préchargé (hors-ligne) si dispo, sinon lecture inline réseau.
  const src = srcMap?.get(file.id) ?? `/api/files/${file.id}?inline=1`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // En vrai plein écran, on occupe tout l'écran (pas de marge) pour la projection.
  const mediaSize = isFs
    ? "max-h-screen max-w-[100vw]"
    : "max-h-[92vh] max-w-[94vw]";
  const frameSize = isFs ? "h-screen w-[100vw]" : "h-[92vh] w-[94vw]";

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black ${isFs ? "p-0" : "p-4"}`}
      role="dialog"
      aria-modal="true"
      aria-label={file.original_name}
      onClick={() => handlers.current.onClose()}
    >
      {/* En vrai plein écran (projection) : aucun chrome par-dessus l'image.
          Navigation au clavier (flèches) + Échap pour sortir. Hors plein écran
          réel (overlay de repli), on garde les contrôles à l'écran. */}
      {!isFs && (
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          {fsSupported && (
            <button
              type="button"
              aria-label="Plein écran"
              title="Plein écran (F)"
              onClick={(e) => {
                stop(e);
                goFullscreen();
              }}
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-black/70"
            >
              Plein écran ⤢
            </button>
          )}
          <button
            type="button"
            aria-label="Fermer"
            autoFocus
            onClick={(e) => {
              stop(e);
              handlers.current.onClose();
            }}
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-black/70"
          >
            Fermer ✕
          </button>
        </div>
      )}

      {hasPrev && !isFs && (
        <button
          type="button"
          aria-label="Précédent"
          onClick={(e) => {
            stop(e);
            onPrev();
          }}
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/40 px-3 py-2 text-lg text-zinc-200 transition-colors hover:bg-black/70 sm:left-4"
        >
          ‹
        </button>
      )}
      {hasNext && !isFs && (
        <button
          type="button"
          aria-label="Suivant"
          onClick={(e) => {
            stop(e);
            onNext();
          }}
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-black/40 px-3 py-2 text-lg text-zinc-200 transition-colors hover:bg-black/70 sm:right-4"
        >
          ›
        </button>
      )}

      <div
        onClick={stop}
        className="flex max-h-full max-w-full items-center justify-center"
      >
        {file.mime?.startsWith("image/") ? (
          <FadeImage
            key={file.id}
            src={src}
            alt={file.original_name}
            className={`${mediaSize} rounded object-contain`}
          />
        ) : isVideo(file.mime, file.original_name) ? (
          <video controls autoPlay src={src} className={`${mediaSize} rounded`} />
        ) : isPdf(file.mime, file.original_name) ? (
          <iframe
            title={file.original_name}
            src={src}
            className={`${frameSize} rounded border-0 bg-white`}
          />
        ) : isAudio(file.mime, file.original_name) ? (
          <div className="flex w-[90vw] max-w-xl flex-col items-center gap-5">
            <p className="text-balance text-center text-lg text-zinc-100">
              {file.original_name}
            </p>
            <audio controls autoPlay src={src} className="w-full" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-lg text-zinc-100">{file.original_name}</p>
            <a
              href={`/api/files/${file.id}`}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
            >
              Télécharger
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
