"use client";

import { useEffect } from "react";
import { isAudio, isPdf, isVideo } from "@/lib/media";

type LightboxFile = {
  id: string;
  original_name: string;
  mime: string | null;
};

/**
 * Aperçu plein écran d'un fichier. Flèches = fichier précédent/suivant ;
 * Échap / Entrée / Espace / clic sur le fond = fermer.
 */
export function Lightbox({
  file,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
}: {
  file: LightboxFile;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        onPrev();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev]);

  const src = `/api/files/${file.id}?inline=1`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={file.original_name}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Fermer"
        onClick={(e) => {
          stop(e);
          onClose();
        }}
        className="absolute right-4 top-4 z-10 rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-black/70"
      >
        Fermer ✕
      </button>

      {hasPrev && (
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
      {hasNext && (
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={file.original_name}
            className="max-h-[92vh] max-w-[94vw] rounded object-contain"
          />
        ) : isVideo(file.mime, file.original_name) ? (
          <video
            controls
            autoPlay
            src={src}
            className="max-h-[92vh] max-w-[94vw] rounded"
          />
        ) : isPdf(file.mime, file.original_name) ? (
          <iframe
            title={file.original_name}
            src={src}
            className="h-[92vh] w-[94vw] rounded border-0 bg-white"
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
