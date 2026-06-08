"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Upload = {
  key: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

export function UploadZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = useCallback((key: string, data: Partial<Upload>) => {
    setUploads((list) =>
      list.map((u) => (u.key === key ? { ...u, ...data } : u)),
    );
  }, []);

  const uploadOne = useCallback(
    (file: File) =>
      new Promise<void>((resolve) => {
        const key = crypto.randomUUID();
        setUploads((list) => [
          ...list,
          { key, name: file.name, progress: 0, status: "uploading" },
        ]);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.setRequestHeader(
          "content-type",
          file.type || "application/octet-stream",
        );
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            patch(key, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () => {
          if (xhr.status === 201) {
            patch(key, { progress: 100, status: "done" });
          } else {
            let msg = "Échec de l'envoi";
            try {
              msg = JSON.parse(xhr.responseText).error ?? msg;
            } catch {}
            patch(key, { status: "error", error: msg });
          }
          resolve();
        };
        xhr.onerror = () => {
          patch(key, { status: "error", error: "Erreur réseau" });
          resolve();
        };
        xhr.send(file);
      }),
    [patch],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      await Promise.all(Array.from(files).map(uploadOne));
      router.refresh();
    },
    [uploadOne, router],
  );

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
            <li
              key={u.key}
              className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-zinc-200">{u.name}</span>
                <span
                  className={
                    u.status === "error"
                      ? "text-red-400"
                      : u.status === "done"
                        ? "text-green-400"
                        : "text-zinc-400"
                  }
                >
                  {u.status === "error"
                    ? (u.error ?? "Erreur")
                    : u.status === "done"
                      ? "Terminé"
                      : `${u.progress}%`}
                </span>
              </div>
              {u.status === "uploading" && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-zinc-300 transition-all"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
