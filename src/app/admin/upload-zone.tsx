"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { formatBytes, formatDuration } from "@/lib/format";
import {
  cancelUpload,
  clearFinishedUploads,
  enqueueUploads,
  getUploadsServerSnapshot,
  getUploadsSnapshot,
  isActiveState,
  retryUpload,
  subscribeUploads,
  type UploadItem,
} from "@/lib/upload-queue";

/**
 * Zone de dépôt. Les envois partent par morceaux dans la file globale
 * (`src/lib/upload-queue.ts`) : ils continuent si on change de vue, et la liste
 * ci-dessous montre TOUS les envois en cours, quel que soit leur dossier.
 */
export function UploadZone({ folderId }: { folderId?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const confirm = useConfirm();
  const uploads = useSyncExternalStore(
    subscribeUploads,
    getUploadsSnapshot,
    getUploadsServerSnapshot,
  );

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    enqueueUploads(Array.from(files), folderId ?? null);
  };

  const askCancel = async (u: UploadItem) => {
    if (u.state === "error") {
      cancelUpload(u.key);
      return;
    }
    const ok = await confirm({
      title: "Annuler l'envoi ?",
      message:
        u.sent > 0
          ? `« ${u.name} » : les ${formatBytes(u.sent)} déjà envoyés seront perdus.`
          : `« ${u.name} » ne sera pas envoyé.`,
      confirmLabel: "Annuler l'envoi",
      cancelLabel: "Continuer",
      danger: true,
    });
    if (ok) cancelUpload(u.key);
  };

  const hasFinished = uploads.some((u) => u.state === "done");

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-zinc-400 bg-zinc-900"
            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50"
        }`}
      >
        <span className="text-sm font-medium text-zinc-200">
          Glisse des fichiers ici
        </span>
        <span className="text-xs text-zinc-500">ou clique pour les choisir</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {uploads.map((u) => (
            <UploadRow
              key={u.key}
              upload={u}
              onCancel={() => void askCancel(u)}
              onRetry={() => retryUpload(u.key)}
            />
          ))}
        </ul>
      )}

      {hasFinished && (
        <button
          type="button"
          onClick={clearFinishedUploads}
          className="self-end text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Effacer les envois terminés
        </button>
      )}
    </div>
  );
}

function UploadRow({
  upload: u,
  onCancel,
  onRetry,
}: {
  upload: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active = isActiveState(u.state);
  const percent = u.size > 0 ? Math.floor((u.sent / u.size) * 100) : 0;
  const eta = u.speed && u.speed > 0 ? (u.size - u.sent) / u.speed : null;

  let detail: string;
  if (u.state === "done") detail = `Terminé · ${formatBytes(u.size)}`;
  else if (u.state === "error") detail = u.message ?? "Erreur";
  else if (u.state === "queued") detail = `En attente · ${formatBytes(u.size)}`;
  else {
    detail = `${formatBytes(u.sent)} / ${formatBytes(u.size)} · ${percent} %`;
    if (u.state === "retrying") detail += ` · ${u.message ?? "Reprise…"}`;
    else if (u.speed) {
      detail += ` · ${formatBytes(u.speed)}/s`;
      if (eta !== null) detail += ` · ~${formatDuration(eta)} restantes`;
    }
  }

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-zinc-200">{u.name}</span>
        <span className="flex shrink-0 items-center gap-3 text-xs">
          {u.state === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className="text-zinc-300 transition-colors hover:text-zinc-100"
            >
              Réessayer
            </button>
          )}
          {(active || u.state === "error") && (
            <button
              type="button"
              onClick={onCancel}
              className="text-zinc-500 transition-colors hover:text-red-400"
            >
              {u.state === "error" ? "Retirer" : "Annuler"}
            </button>
          )}
        </span>
      </div>
      <span
        className={`text-xs ${
          u.state === "error"
            ? "text-red-400"
            : u.state === "done"
              ? "text-green-400"
              : u.state === "retrying"
                ? "text-amber-400"
                : "text-zinc-400"
        }`}
      >
        {detail}
      </span>
      {active && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full transition-all ${
              u.state === "retrying" ? "bg-amber-400" : "bg-zinc-300"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </li>
  );
}
