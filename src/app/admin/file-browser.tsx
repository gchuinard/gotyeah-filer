"use client";

import { useState } from "react";
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
  const cls = big ? "size-16 text-sm" : "size-10 text-[10px]";
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
      className={`flex ${cls} shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-medium text-zinc-500`}
    >
      {extLabel(file.original_name)}
    </div>
  );
}

/**
 * Vue admin « master-détail » : la liste des fichiers dans un aside (avec
 * actions par ligne : télécharger / partager / supprimer), l'aperçu en grand
 * au centre quand on sélectionne un fichier.
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareOpenId, setShareOpenId] = useState<string | null>(null);

  // Sélection robuste : retombe sur le 1er fichier si l'id n'existe plus
  // (ex. après suppression + refresh).
  const selected = files.find((f) => f.id === selectedId) ?? files[0] ?? null;

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
      {/* Aside : liste des fichiers + actions par ligne */}
      <aside className="md:w-80 md:shrink-0">
        <h2 className="mb-2 text-xs font-medium text-zinc-500">
          Fichiers ({files.length})
        </h2>
        <ul className="flex flex-col divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
          {files.map((f) => {
            const active = selected?.id === f.id;
            return (
              <li
                key={f.id}
                className={active ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"}
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
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Centre : aperçu en grand + détails + actions du fichier sélectionné */}
      <section className="min-w-0 flex-1">
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="flex min-h-[16rem] items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-2">
              {selected.mime?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/files/${selected.id}?inline=1`}
                  alt={selected.original_name}
                  className="max-h-[70vh] w-auto max-w-full rounded object-contain"
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
                <h3 className="text-balance text-lg font-semibold text-zinc-100">
                  {selected.original_name}
                </h3>
                <p className="text-sm text-zinc-500">
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
