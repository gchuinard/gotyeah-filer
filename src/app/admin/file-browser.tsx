"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useConfirm } from "@/components/confirm-dialog";
import { Lightbox } from "@/components/lightbox";
import { ProjectionPrep } from "@/components/projection-prep";
import { ProjectionRegie } from "@/components/projection-regie";
import { useImagePreload } from "@/lib/use-image-preload";
import { useFileNotes } from "@/lib/use-file-notes";
import { ImageEditor } from "@/components/image-editor";
import { DeleteButton } from "@/app/admin/delete-button";
import { MoveSelect } from "@/app/admin/move-select";
import { type Share } from "@/app/admin/share-manager";
import { ShareDialog } from "@/app/admin/share-dialog";

export type FileItem = {
  id: string;
  original_name: string;
  mime: string | null;
  size: number;
  created_at: number;
  folder_id: string | null;
  download_count: number;
  note: string | null;
};

type Option = { id: string; name: string };

/** Vignette : image servie inline (ne compte pas), sinon pastille d'extension. */
function Thumb({ file, big = false }: { file: FileItem; big?: boolean }) {
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
 * Vue admin « master-détail » : la liste des fichiers dans un aside défilant
 * (avec cases à cocher pour des actions groupées + actions par ligne), l'aperçu
 * en grand au centre quand on sélectionne un fichier.
 */
export function FileBrowser({
  files,
  folders,
  appUrl,
  shares,
  noFilesAtAll,
}: {
  files: FileItem[];
  folders: Option[];
  appUrl: string;
  shares: Record<string, Share[]>;
  noFilesAtAll: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [offline, setOffline] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Retouche depuis le mode présentateur : id ouvert dans une modale par-dessus
  // la régie (distinct de `editingId`, qui pilote l'éditeur inline de l'explorateur).
  const [presenterEditId, setPresenterEditId] = useState<string | null>(null);
  // Cache-bust local après « Écraser l'original » : l'URL inline est cachée
  // ~5 min → on force le rechargement de l'aperçu de l'image écrasée.
  const [bustMap, setBustMap] = useState<Map<string, number>>(() => new Map());
  const bustPreview = (id: string) => {
    const v = Date.now();
    setBustMap((prev) => new Map(prev).set(id, v));
  };
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Recherche par nom, puis filtre par type, puis tri. Les comptes des chips
  // reflètent la recherche courante.
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

  // Sélection robuste : retombe sur le 1er fichier visible si l'id n'existe
  // plus (ex. après suppression/refresh) ou n'est plus dans la vue.
  const selected =
    visible.find((f) => f.id === selectedId) ?? visible[0] ?? null;

  // Flèches ↑/↓ : fichier précédent / suivant ; Entrée/Espace : aperçu en grand.
  useListKeyboardNav(visible, selected?.id ?? null, setSelectedId, () =>
    setLightbox(true),
  );

  // Navigation au sein du plein écran.
  function lightboxStep(dir: 1 | -1) {
    if (!selected) return;
    const i = visible.findIndex((f) => f.id === selected.id);
    const ni =
      dir > 0 ? Math.min(i + 1, visible.length - 1) : Math.max(i - 1, 0);
    setSelectedId(visible[ni].id);
  }
  const lbIndex = selected
    ? visible.findIndex((f) => f.id === selected.id)
    : -1;
  // Image de départ / courante du mode présentateur (jamais hors bornes).
  const presenterIndex = lbIndex >= 0 ? lbIndex : 0;
  const presenterFile = visible[presenterIndex] ?? null;
  // Cible de la retouche lancée depuis la régie (modale par-dessus le présentateur).
  const presenterEdit = presenterEditId
    ? (files.find((f) => f.id === presenterEditId) ?? null)
    : null;

  // Préchargement « projection hors-ligne » des images de la vue courante.
  const preload = useImagePreload(visible, offline);
  // Notes par fichier persistées en base (édition optimiste + debounce).
  const { noteOf, setNote } = useFileNotes(files);
  const imageCount = visible.filter((f) =>
    f.mime?.startsWith("image/"),
  ).length;
  const inlineSrc = (f: FileItem) => {
    const blob = preload.urls.get(f.id);
    if (blob) return blob;
    const v = bustMap.get(f.id);
    return `/api/files/${f.id}?inline=1${v != null ? `&v=${v}` : ""}`;
  };

  // Image matricielle retouchable (le SVG est exclu : non pixellisable proprement).
  const canEdit =
    !!selected?.mime?.startsWith("image/") &&
    selected.mime !== "image/svg+xml" &&
    !selected.original_name.toLowerCase().endsWith(".svg");

  // Mode retouche lié au fichier courant : changer de sélection le quitte
  // naturellement (état dérivé, sans effet).
  const editing = !!selected && editingId === selected.id;

  // Changer la vue (filtre/recherche) réinitialise la sélection (évite des
  // coches « cachées » qui seraient incluses dans une action groupée).
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

  async function bulkMove(folderId: string | null) {
    if (checked.size === 0) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        [...checked].map((id) =>
          fetch(`/api/files/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ folderId }),
          }),
        ),
      );
      clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Télécharge la sélection en .zip via un POST de formulaire : le navigateur
   * stream la réponse vers le disque (pas de limite d'URL, pas de buffer JS).
   */
  function bulkDownloadZip() {
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

  async function bulkDelete() {
    if (checked.size === 0) return;
    const ok = await confirm({
      title: `Supprimer ${checked.size} fichier${checked.size > 1 ? "s" : ""} ?`,
      message: "Cette action est définitive.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        [...checked].map((id) => fetch(`/api/files/${id}`, { method: "DELETE" })),
      );
      clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  if (files.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
        {noFilesAtAll
          ? "Aucun fichier pour l'instant. Dépose ton premier fichier ci-dessus."
          : "Aucun fichier dans cette vue."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      {/* Aside : liste défilante + sélection multiple + actions par ligne */}
      <aside className="md:sticky md:top-4 md:w-80 md:shrink-0 md:self-start">
        <input
          type="search"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Rechercher un fichier…"
          className="mb-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <FilterChips counts={counts} active={filter} onSelect={selectFilter} />

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
            <ProjectionPrep
              imageCount={imageCount}
              enabled={offline}
              onToggle={setOffline}
              state={preload}
            />
            {imageCount > 0 && (
              <button
                type="button"
                onClick={() => setPresenter(true)}
                className="mb-3 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
              >
                Mode présentateur (2 écrans)
              </button>
            )}
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
            <select
              aria-label="Déplacer la sélection"
              disabled={bulkBusy}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                bulkMove(v === "__root__" ? null : v);
                e.target.value = "";
              }}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-300 outline-none focus:border-zinc-500 disabled:opacity-50"
            >
              <option value="" disabled>
                Déplacer vers…
              </option>
              <option value="__root__">Aucun dossier</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={bulkDownloadZip}
              className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              Télécharger (.zip)
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={bulkDelete}
              className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-400 transition-colors hover:border-red-900 hover:text-red-400 disabled:opacity-50"
            >
              Supprimer
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
                className={active ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"}
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
                          {formatBytes(f.size)} · ↓ {f.download_count}
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center gap-3 pl-[3.25rem] text-xs">
                      <a
                        href={`/api/files/${f.id}`}
                        className="text-zinc-400 transition-colors hover:text-zinc-100"
                      >
                        Télécharger
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(f.id);
                          setShareTarget({ id: f.id, name: f.original_name });
                        }}
                        className="text-zinc-400 transition-colors hover:text-zinc-100"
                      >
                        Partager
                      </button>
                      <DeleteButton
                        id={f.id}
                        name={f.original_name}
                        label="Supprimer"
                        className="text-zinc-500 transition-colors hover:text-red-400 disabled:opacity-50"
                        onDeleted={() => {
                          if (selectedId === f.id) setSelectedId(null);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </li>
                );
              })}
            </ul>
          </>
        )}
      </aside>

      {/* Centre : aperçu en grand + détails + actions du fichier sélectionné */}
      <section className="min-w-0 flex-1">
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-balance text-2xl font-semibold text-zinc-100">
                  {selected.original_name}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {formatBytes(selected.size)} · {formatDate(selected.created_at)}{" "}
                  · ↓ {selected.download_count}
                </p>
              </div>
              {!editing && (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/files/${selected.id}`}
                    className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
                  >
                    Télécharger
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      setShareTarget({
                        id: selected.id,
                        name: selected.original_name,
                      })
                    }
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
                  >
                    Partager
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditingId(selected.id)}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
                    >
                      Retoucher
                    </button>
                  )}
                  <MoveSelect
                    key={selected.id}
                    fileId={selected.id}
                    folders={folders}
                    current={selected.folder_id}
                  />
                  <DeleteButton id={selected.id} name={selected.original_name} />
                </div>
              )}
            </div>
            {!editing && (
              <div>
                <label
                  htmlFor="file-note"
                  className="mb-1.5 block text-xs font-medium text-zinc-500"
                >
                  Note
                </label>
                <textarea
                  id="file-note"
                  value={noteOf(selected.id)}
                  onChange={(e) => setNote(selected.id, e.target.value)}
                  placeholder="Note libre liée à ce fichier (visible aussi en mode présentateur)…"
                  className="h-24 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
                />
              </div>
            )}
            {editing && canEdit ? (
              <ImageEditor
                key={selected.id}
                file={selected}
                folders={folders}
                bustValue={bustMap.get(selected.id)}
                onDone={() => setEditingId(null)}
                onSaved={(id) => {
                  setEditingId(null);
                  setSelectedId(id);
                  bustPreview(id);
                }}
              />
            ) : (
            <div className="flex min-h-[20rem] items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-2">
              {selected.mime?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={inlineSrc(selected)}
                  alt={selected.original_name}
                  onClick={() => setLightbox(true)}
                  className="max-h-[78vh] w-auto max-w-full cursor-zoom-in rounded object-contain"
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
                  {/* Lecture inline : seek via Range, ne compte pas comme download. */}
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
            )}
          </div>
        )}
      </section>

      {shareTarget && (
        <ShareDialog
          key={shareTarget.id}
          fileId={shareTarget.id}
          fileName={shareTarget.name}
          appUrl={appUrl}
          initialShares={shares[shareTarget.id] ?? []}
          onClose={() => setShareTarget(null)}
        />
      )}

      {lightbox && selected && (
        <Lightbox
          file={selected}
          hasPrev={lbIndex > 0}
          hasNext={lbIndex >= 0 && lbIndex < visible.length - 1}
          onPrev={() => lightboxStep(-1)}
          onNext={() => lightboxStep(1)}
          onClose={() => setLightbox(false)}
          srcMap={preload.urls}
        />
      )}

      {presenter && (
        <ProjectionRegie
          files={visible.map((f) => ({
            id: f.id,
            original_name: f.original_name,
            mime: f.mime,
          }))}
          index={presenterIndex}
          onIndex={(i) => {
            const f = visible[i];
            if (f) setSelectedId(f.id);
          }}
          note={presenterFile ? noteOf(presenterFile.id) : ""}
          onNote={(v) => {
            if (presenterFile) setNote(presenterFile.id, v);
          }}
          onEdit={() => {
            if (canEdit && selected) setPresenterEditId(selected.id);
          }}
          onNoteById={(id, v) => setNote(id, v)}
          onRetouched={(id) => {
            router.refresh();
            bustPreview(id);
          }}
          paused={!!presenterEditId}
          onClose={() => setPresenter(false)}
        />
      )}

      {/* Retouche lancée depuis la régie : l'éditeur existant dans une modale
          au-dessus du présentateur (z-[80] > régie z-[70] ; son SaveDialog
          interne reste au-dessus via le contexte d'empilement de la modale).
          « Enregistrer sous… » crée une copie (router.refresh) sans changer la
          sélection → l'image projetée sur l'écran public ne bouge pas. */}
      {presenterEdit && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-zinc-950/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Retoucher l'image"
        >
          <div className="my-auto w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="min-w-0 truncate text-lg font-semibold text-zinc-100">
                Retoucher — {presenterEdit.original_name}
              </h2>
              <button
                type="button"
                onClick={() => setPresenterEditId(null)}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
              >
                Fermer ✕
              </button>
            </div>
            <ImageEditor
              key={presenterEdit.id}
              file={presenterEdit}
              folders={folders}
              live
              bustValue={bustMap.get(presenterEdit.id)}
              onDone={() => setPresenterEditId(null)}
              onSaved={(id) => {
                setPresenterEditId(null);
                bustPreview(id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
