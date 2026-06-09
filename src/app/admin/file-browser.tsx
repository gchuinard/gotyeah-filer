"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { extLabel, formatBytes, formatDate } from "@/lib/format";
import { DeleteButton } from "@/app/admin/delete-button";
import { MoveSelect } from "@/app/admin/move-select";
import { ShareManager, type Share } from "@/app/admin/share-manager";

export type FileItem = {
  id: string;
  original_name: string;
  mime: string | null;
  size: number;
  created_at: number;
  folder_id: string | null;
  download_count: number;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareOpenId, setShareOpenId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Sélection robuste : retombe sur le 1er fichier si l'id n'existe plus
  // (ex. après suppression + refresh).
  const selected = files.find((f) => f.id === selectedId) ?? files[0] ?? null;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allChecked = files.length > 0 && checked.size === files.length;
  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(files.map((f) => f.id)));
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
      setChecked(new Set());
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (checked.size === 0) return;
    if (
      !window.confirm(
        `Supprimer ${checked.size} fichier${checked.size > 1 ? "s" : ""} ? Cette action est définitive.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      await Promise.all(
        [...checked].map((id) => fetch(`/api/files/${id}`, { method: "DELETE" })),
      );
      setChecked(new Set());
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="size-3.5 accent-zinc-300"
            />
            Fichiers ({files.length})
          </label>
          {checked.size > 0 && (
            <button
              type="button"
              onClick={() => setChecked(new Set())}
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
              disabled={bulkBusy}
              onClick={bulkDelete}
              className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-400 transition-colors hover:border-red-900 hover:text-red-400 disabled:opacity-50"
            >
              Supprimer
            </button>
          </div>
        )}

        <ul className="flex max-h-[60vh] flex-col divide-y divide-zinc-800 overflow-y-auto overflow-x-hidden rounded-xl border border-zinc-800 md:max-h-[calc(100vh-2rem)]">
          {files.map((f) => {
            const active = selected?.id === f.id;
            return (
              <li
                key={f.id}
                className={active ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"}
              >
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${f.original_name}`}
                    checked={checked.has(f.id)}
                    onChange={() => toggle(f.id)}
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
                          setShareOpenId(f.id);
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
      </aside>

      {/* Centre : aperçu en grand + détails + actions du fichier sélectionné */}
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
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/files/${selected.id}`}
                  className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
                >
                  Télécharger
                </a>
                <MoveSelect
                  key={selected.id}
                  fileId={selected.id}
                  folders={folders}
                  current={selected.folder_id}
                />
                <DeleteButton id={selected.id} name={selected.original_name} />
              </div>
              <ShareManager
                key={`${selected.id}-${shareOpenId}`}
                endpoint={`/api/files/${selected.id}/shares`}
                appUrl={appUrl}
                initialShares={shares[selected.id] ?? []}
                defaultOpen={shareOpenId === selected.id}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
