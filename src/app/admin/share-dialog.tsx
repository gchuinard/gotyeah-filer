"use client";

import { useEffect } from "react";
import { ShareManager, type Share } from "@/app/admin/share-manager";

/** Modale de partage d'un fichier : saisie des e-mails autorisés + lien. */
export function ShareDialog({
  fileId,
  fileName,
  appUrl,
  initialShares,
  onClose,
}: {
  fileId: string;
  fileName: string;
  appUrl: string;
  initialShares: Share[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Partager ${fileName}`}
    >
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Partager</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-1 -mt-1 rounded-lg p-1 text-zinc-500 transition-colors hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 max-w-full truncate text-sm text-zinc-400">
          {fileName}
        </p>
        <ShareManager
          endpoint={`/api/files/${fileId}/shares`}
          appUrl={appUrl}
          initialShares={initialShares}
          bare
        />
      </div>
    </div>
  );
}
