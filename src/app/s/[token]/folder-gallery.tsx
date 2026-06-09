"use client";

import { useState } from "react";
import { extLabel, formatBytes, formatDate } from "@/lib/format";

export type GalleryFile = {
  id: string;
  original_name: string;
  mime: string | null;
  size: number;
  created_at: number;
};

function Thumb({ file, big = false }: { file: GalleryFile; big?: boolean }) {
  if (file.mime?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${file.id}?inline=1`}
        alt=""
        loading="lazy"
        className={`${big ? "size-16" : "size-10"} shrink-0 rounded-md border border-zinc-800 object-cover`}
      />
    );
  }
  return (
    <div
      className={`flex ${big ? "size-16 text-sm" : "size-10 text-[10px]"} shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-medium text-zinc-500`}
    >
      {extLabel(file.original_name)}
    </div>
  );
}

/**
 * Vue invité d'un dossier partagé en « master-détail » : liste des fichiers à
 * gauche (download par ligne) + aperçu en grand au centre. Lecture seule.
 */
export function FolderGallery({
  files,
  folderName,
  folderId,
}: {
  files: GalleryFile[];
  folderName: string;
  folderId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = files.find((f) => f.id === selectedId) ?? files[0] ?? null;

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Dossier partagé
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{folderName}</h1>
          <p className="text-sm text-zinc-500">
            {files.length} fichier{files.length > 1 ? "s" : ""}
          </p>
        </div>
        {files.length > 0 && (
          <a
            href={`/api/folders/${folderId}/download`}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
          >
            Tout télécharger (.zip)
          </a>
        )}
      </div>

      {files.length === 0 ? (
        <p className="mt-8 rounded-xl border border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
          Aucun fichier dans ce dossier pour l&apos;instant.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4 md:flex-row md:gap-6">
          {/* Aside : liste défilante + download par ligne */}
          <aside className="md:sticky md:top-4 md:w-80 md:shrink-0 md:self-start">
            <ul className="flex max-h-[60vh] flex-col divide-y divide-zinc-800 overflow-y-auto overflow-x-hidden rounded-xl border border-zinc-800 md:max-h-[calc(100vh-2rem)]">
              {files.map((f) => {
                const active = selected?.id === f.id;
                return (
                  <li
                    key={f.id}
                    className={
                      active ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"
                    }
                  >
                    <div className="flex flex-col gap-1.5 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setSelectedId(f.id)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <Thumb file={f} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-zinc-100">
                            {f.original_name}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            {formatBytes(f.size)}
                          </span>
                        </span>
                      </button>
                      <a
                        href={`/api/files/${f.id}`}
                        className="pl-[3.25rem] text-xs text-zinc-400 transition-colors hover:text-zinc-100"
                      >
                        Télécharger
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Centre : aperçu en grand */}
          <section className="min-w-0 flex-1">
            {selected && (
              <div className="flex flex-col gap-4">
                <div className="flex min-h-[20rem] items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                  {selected.mime?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${selected.id}?inline=1`}
                      alt={selected.original_name}
                      className="max-h-[78vh] w-auto max-w-full rounded object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                      <Thumb file={selected} big />
                      <p className="text-sm text-zinc-500">
                        Aperçu indisponible pour ce type de fichier.
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-balance text-2xl font-semibold text-zinc-100">
                      {selected.original_name}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      {formatBytes(selected.size)} ·{" "}
                      {formatDate(selected.created_at)}
                    </p>
                  </div>
                  <a
                    href={`/api/files/${selected.id}`}
                    className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
                  >
                    Télécharger
                  </a>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
