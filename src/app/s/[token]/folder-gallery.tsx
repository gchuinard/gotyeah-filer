"use client";

import { useState } from "react";
import { extLabel, formatBytes, formatDate } from "@/lib/format";
import {
  categoryCounts,
  isAudio,
  isPdf,
  isVideo,
  matchesFilter,
  type MediaFilter,
} from "@/lib/media";
import { useMultiSelect } from "@/lib/use-multi-select";
import { useListKeyboardNav } from "@/lib/use-list-keyboard-nav";
import { sortFiles, type SortField, type SortDir } from "@/lib/sort";
import { FilterChips } from "@/components/filter-chips";
import { SortControl } from "@/components/sort-control";

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
 * gauche (download + sélection multiple) + aperçu en grand au centre. La
 * sélection se télécharge en .zip via /api/download (filtré côté serveur aux
 * fichiers du dossier partagé). Lecture seule.
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
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const q = query.trim().toLowerCase();
  const searched = q
    ? files.filter((f) => f.original_name.toLowerCase().includes(q))
    : files;
  const counts = categoryCounts(searched);
  const visible = sortFiles(
    searched.filter((f) => matchesFilter(f, filter)),
    sortField,
    sortDir,
  );

  const { checked, allChecked, toggleAll, clear, checkboxProps } =
    useMultiSelect(visible);
  const selected =
    visible.find((f) => f.id === selectedId) ?? visible[0] ?? null;

  // Flèches ↑/↓ : passe au fichier précédent / suivant (au lieu de scroller).
  useListKeyboardNav(visible, selected?.id ?? null, setSelectedId);

  function selectFilter(next: MediaFilter) {
    setFilter(next);
    clear();
    setSelectedId(null);
  }
  function search(next: string) {
    setQuery(next);
    clear();
    setSelectedId(null);
  }

  /** Télécharge la sélection en .zip via un POST de formulaire (streaming). */
  function downloadSelection() {
    if (checked.size === 0) return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/download";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "ids";
    input.value = [...checked].join(",");
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

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
          {/* Aside : liste défilante + sélection multiple + download par ligne */}
          <aside className="md:sticky md:top-4 md:w-80 md:shrink-0 md:self-start">
            <input
              type="search"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Rechercher un fichier…"
              className="mb-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            />
            <FilterChips
              counts={counts}
              active={filter}
              onSelect={selectFilter}
            />

            {visible.length === 0 ? (
              <p className="rounded-xl border border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                Aucun fichier ne correspond.
              </p>
            ) : (
              <>
            <SortControl
              field={sortField}
              dir={sortDir}
              onField={setSortField}
              onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            />
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="size-3.5 accent-zinc-300"
                />
                Fichiers ({visible.length})
              </label>
              {checked.size > 0 && (
                <button
                  type="button"
                  onClick={() => clear()}
                  className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Désélectionner
                </button>
              )}
            </div>

            {checked.size > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs">
                <span className="text-zinc-300">
                  {checked.size} sélectionné{checked.size > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={downloadSelection}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  Télécharger (.zip)
                </button>
              </div>
            )}

            <ul className="flex max-h-[60vh] flex-col divide-y divide-zinc-800 overflow-y-auto overflow-x-hidden rounded-xl border border-zinc-800 md:max-h-[calc(100vh-2rem)]">
              {visible.map((f, index) => {
                const active = selected?.id === f.id;
                return (
                  <li
                    key={f.id}
                    data-navitem={f.id}
                    className={
                      active ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"
                    }
                  >
                    <div className="flex items-start gap-2 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${f.original_name}`}
                        {...checkboxProps(index, f.id)}
                        className="mt-1 size-3.5 shrink-0 accent-zinc-300"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
                    </div>
                  </li>
                );
              })}
            </ul>
              </>
            )}
          </aside>

          {/* Centre : aperçu en grand */}
          <section className="min-w-0 flex-1">
            {selected && (
              <div className="flex flex-col gap-4">
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
                <div className="flex min-h-[20rem] items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                  {selected.mime?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${selected.id}?inline=1`}
                      alt={selected.original_name}
                      className="max-h-[78vh] w-auto max-w-full rounded object-contain"
                    />
                  ) : isVideo(selected.mime, selected.original_name) ? (
                    <video
                      controls
                      src={`/api/files/${selected.id}?inline=1`}
                      className="max-h-[78vh] max-w-full rounded"
                    />
                  ) : isAudio(selected.mime, selected.original_name) ? (
                    <div className="flex w-full max-w-xl flex-col items-center gap-5 px-4 py-10">
                      <Thumb file={selected} big />
                      <audio
                        controls
                        src={`/api/files/${selected.id}?inline=1`}
                        className="w-full"
                      />
                    </div>
                  ) : isPdf(selected.mime, selected.original_name) ? (
                    <iframe
                      title={selected.original_name}
                      src={`/api/files/${selected.id}?inline=1`}
                      className="h-[78vh] w-full rounded border-0 bg-white"
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
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
