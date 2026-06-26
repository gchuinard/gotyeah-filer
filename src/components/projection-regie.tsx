"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  openProjectionChannel,
  type ProjectionMessage,
  type PublicFile,
} from "@/lib/projection-channel";
import { useLocalNotes } from "@/lib/use-local-notes";
import { PresenterTimer } from "@/components/presenter-timer";

type Progress = { ready: number; total: number; failed: number };

function isImageFile(f: PublicFile): boolean {
  return !!f.mime?.startsWith("image/");
}

/**
 * Console RÉGIE du mode présentateur (sur l'écran de l'opérateur). Affiche
 * l'image courante + la suivante + les contrôles, et pilote la fenêtre PUBLIC
 * (le 2e écran) via `BroadcastChannel`. La fenêtre public, elle, n'affiche que
 * l'image, plein écran (cf. `ProjectionScreen` / `/admin/projection`).
 *
 * Contrôlée par le parent : `index` = position courante dans `files`, `onIndex`
 * la fait varier (source de vérité unique = la sélection du parent). À la
 * fermeture (démontage), la fenêtre public est refermée et le canal libéré.
 */
export function ProjectionRegie({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: PublicFile[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const [publicOpen, setPublicOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    ready: 0,
    total: 0,
    failed: 0,
  });

  const chanRef = useRef<BroadcastChannel | null>(null);
  const publicWinRef = useRef<Window | null>(null);

  // Miroirs pour des callbacks/listeners stables (pas de re-souscription).
  // Mis à jour dans un effet, jamais pendant le render (règle react-hooks/refs).
  const filesRef = useRef(files);
  const indexRef = useRef(index);
  const onIndexRef = useRef(onIndex);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    filesRef.current = files;
    indexRef.current = index;
    onIndexRef.current = onIndex;
    onCloseRef.current = onClose;
  });
  // Dernière position diffusée : évite l'écho (public → régie → public).
  const lastIdxRef = useRef(-1);

  const max = files.length - 1;
  const current = files[index] ?? null;
  const next = index < max ? files[index + 1] : null;

  // Bloc-notes local (localStorage) de l'image courante.
  const [note, setNote] = useLocalNotes(current?.id ?? null);

  // — Canal : écoute + teardown (referme la fenêtre public à la sortie) —
  useEffect(() => {
    const chan = openProjectionChannel();
    chanRef.current = chan;
    if (chan) {
      chan.onmessage = (e: MessageEvent<ProjectionMessage>) => {
        const msg = e.data;
        if (msg.type === "hello") {
          chan.postMessage({
            type: "sync",
            files: filesRef.current,
            index: indexRef.current,
          } satisfies ProjectionMessage);
          lastIdxRef.current = indexRef.current;
          setPublicOpen(true);
        } else if (msg.type === "index") {
          lastIdxRef.current = msg.index;
          onIndexRef.current(msg.index);
        } else if (msg.type === "progress") {
          setProgress({
            ready: msg.ready,
            total: msg.total,
            failed: msg.failed,
          });
        } else if (msg.type === "public-closed") {
          setPublicOpen(false);
        }
      };
    }
    return () => {
      if (chan) {
        try {
          chan.postMessage({ type: "close" } satisfies ProjectionMessage);
        } catch {
          /* canal déjà fermé */
        }
        chan.close();
      }
      chanRef.current = null;
      try {
        publicWinRef.current?.close();
      } catch {
        /* fenêtre déjà fermée */
      }
      publicWinRef.current = null;
    };
  }, []);

  // Diffuse chaque changement de position vers la fenêtre public (sauf écho).
  useEffect(() => {
    const chan = chanRef.current;
    if (!chan) return;
    if (lastIdxRef.current === index) return;
    lastIdxRef.current = index;
    chan.postMessage({ type: "index", index } satisfies ProjectionMessage);
  }, [index]);

  // Re-synchronise la liste si elle change (resélection en arrière-plan, etc.).
  const filesKey = files.map((f) => f.id).join(",");
  useEffect(() => {
    const chan = chanRef.current;
    if (!chan) return;
    chan.postMessage({
      type: "sync",
      files: filesRef.current,
      index: indexRef.current,
    } satisfies ProjectionMessage);
    lastIdxRef.current = indexRef.current;
  }, [filesKey]);

  // Détecte la fermeture de la fenêtre public par l'utilisateur (filet de
  // sécurité en plus du message `public-closed`).
  useEffect(() => {
    if (!publicOpen) return;
    const t = setInterval(() => {
      if (publicWinRef.current && publicWinRef.current.closed) {
        setPublicOpen(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [publicOpen]);

  const go = useCallback((dir: 1 | -1) => {
    const m = filesRef.current.length - 1;
    if (m < 0) return;
    const cur = indexRef.current;
    const ni = dir > 0 ? Math.min(cur + 1, m) : Math.max(cur - 1, 0);
    if (ni !== cur) onIndexRef.current(ni);
  }, []);

  // Clavier : ←/→ navigue, Échap quitte le mode présentateur. Inactif pendant
  // la saisie des notes (sinon les flèches déplaceraient le curseur ET l'image).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "TEXTAREA" ||
          el.tagName === "INPUT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  // Ouvre la fenêtre public. Place-la sur le 2e écran si l'API multi-écrans est
  // dispo (Chrome/Edge, 1 autorisation) ; sinon popup standard à glisser sur le
  // projecteur. À déclencher par un clic (geste utilisateur requis).
  async function openPublic() {
    let features = "popup=yes,width=1280,height=720";
    try {
      const w = window as unknown as {
        getScreenDetails?: () => Promise<{
          screens: Array<{
            isPrimary: boolean;
            availLeft: number;
            availTop: number;
            availWidth: number;
            availHeight: number;
          }>;
        }>;
      };
      const scr = window.screen as Screen & { isExtended?: boolean };
      if (w.getScreenDetails && scr.isExtended) {
        const details = await w.getScreenDetails();
        const ext = details.screens.find((s) => !s.isPrimary);
        if (ext) {
          features = `popup=yes,left=${ext.availLeft},top=${ext.availTop},width=${ext.availWidth},height=${ext.availHeight}`;
        }
      }
    } catch {
      /* permission refusée ou API absente → popup standard */
    }
    const win = window.open("/admin/projection", "filer-public", features);
    if (!win) {
      setBlocked(true);
      return;
    }
    publicWinRef.current = win;
    setBlocked(false);
    setPublicOpen(true);
    // Sync proactif (en plus du `hello` émis par la fenêtre à son chargement).
    chanRef.current?.postMessage({
      type: "sync",
      files: filesRef.current,
      index: indexRef.current,
    } satisfies ProjectionMessage);
  }

  const done = progress.ready + progress.failed;
  const pct = progress.total > 0 ? Math.round((done / progress.total) * 100) : 0;
  const preloadDone = progress.total > 0 && done >= progress.total;

  const statusText = !publicOpen
    ? "Écran public non ouvert"
    : !preloadDone && progress.total > 0
      ? `Écran public ouvert · préchargement ${done}/${progress.total}`
      : progress.failed > 0
        ? `Écran public ouvert · ${progress.ready}/${progress.total} prêtes · ${progress.failed} échec`
        : `Écran public ouvert · ${progress.ready} image${progress.ready > 1 ? "s" : ""} prête${progress.ready > 1 ? "s" : ""}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-zinc-950 text-zinc-100"
      role="dialog"
      aria-modal="true"
      aria-label="Mode présentateur"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Mode présentateur</p>
          <p className="truncate text-xs text-zinc-500">{statusText}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
        >
          Quitter ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        {/* Aperçu de l'image courante */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black">
          {current ? (
            isImageFile(current) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${current.id}?inline=1`}
                alt={current.original_name}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <p className="text-sm text-zinc-300">{current.original_name}</p>
                <p className="text-xs text-zinc-500">
                  (aperçu non-image — projeté sur l&apos;écran public)
                </p>
              </div>
            )
          ) : (
            <p className="text-sm text-zinc-500">Aucune image à projeter</p>
          )}
        </div>

        {/* Colonne régie */}
        <div className="flex min-h-0 w-full shrink-0 flex-col gap-4 lg:w-80">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="rounded-xl border border-zinc-800 p-3">
            {!publicOpen ? (
              <>
                <button
                  type="button"
                  onClick={openPublic}
                  className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
                >
                  Ouvrir l&apos;écran public
                </button>
                <p className="mt-2 text-xs text-zinc-500">
                  Une fenêtre s&apos;ouvre : glisse-la sur le vidéoprojecteur
                  puis passe-la en plein écran (touche F). Chrome/Edge :
                  placement automatique.
                </p>
                {blocked && (
                  <p className="mt-2 text-xs text-amber-400">
                    Fenêtre bloquée — autorise les pop-ups pour ce site, puis
                    réessaie.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-zinc-300">
                    Écran public ouvert ✓
                  </span>
                  <button
                    type="button"
                    onClick={openPublic}
                    className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                  >
                    Rouvrir
                  </button>
                </div>
                {!preloadDone && progress.total > 0 && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-zinc-300 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Chrono */}
          <PresenterTimer index={index} />

          {/* Notes — bloc-notes local (par image, sur ce navigateur) */}
          <div className="rounded-xl border border-zinc-800 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-500">Notes</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!current}
              placeholder={
                current
                  ? "Notes pour cette image (locales à ce navigateur)…"
                  : "—"
              }
              className="h-28 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
            />
          </div>

          {/* Image suivante */}
          <div className="rounded-xl border border-zinc-800 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-500">Suivante</p>
            {next ? (
              <div className="flex items-center gap-3">
                {isImageFile(next) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${next.id}?inline=1`}
                    alt=""
                    className="size-16 shrink-0 rounded-md border border-zinc-800 object-cover"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-[10px] text-zinc-500">
                    fichier
                  </div>
                )}
                <span className="min-w-0 truncate text-sm text-zinc-300">
                  {next.original_name}
                </span>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">— fin —</p>
            )}
          </div>
          </div>

          {/* Navigation (toujours visible) */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={index <= 0}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-40"
            >
              ‹ Précédent
            </button>
            <span className="shrink-0 text-xs text-zinc-500">
              {files.length === 0 ? "0 / 0" : `${index + 1} / ${files.length}`}
            </span>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={index >= max}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-40"
            >
              Suivant ›
            </button>
          </div>
          <p className="text-center text-[11px] text-zinc-600">
            ←/→ naviguer · Échap quitter
          </p>
        </div>
      </div>
    </div>
  );
}
