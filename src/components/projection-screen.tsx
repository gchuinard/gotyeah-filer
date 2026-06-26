"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAudio, isPdf, isVideo } from "@/lib/media";
import { fsActive, fsEnabled, enterFs } from "@/lib/fullscreen";
import { FadeImage } from "@/components/fade-image";
import { useImagePreload } from "@/lib/use-image-preload";
import {
  openProjectionChannel,
  type ProjectionMessage,
  type PublicFile,
} from "@/lib/projection-channel";

/**
 * Fenêtre PUBLIC du mode présentateur (à poser sur le vidéoprojecteur / 2e
 * écran). N'affiche QUE le média courant, plein écran, fond noir, fondu — aucun
 * chrome. Tout vient de la RÉGIE via `BroadcastChannel` ; cette fenêtre
 * précharge ses propres images (blobs locaux) pour ne pas dépendre du réseau
 * pendant le spectacle, et renvoie sa progression à la régie.
 *
 * Le plein écran réel exige un geste utilisateur : une fenêtre fraîchement
 * ouverte ne peut pas le déclencher seule → on propose un bouton « Plein écran ».
 */
export function ProjectionScreen() {
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [index, setIndex] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const [fsSupported] = useState(
    () => typeof document !== "undefined" && fsEnabled(),
  );

  const chanRef = useRef<BroadcastChannel | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const filesRef = useRef<PublicFile[]>([]);
  const indexRef = useRef(0);

  // La fenêtre public DOIT être robuste hors-ligne → préchargement permanent.
  const preload = useImagePreload(files, true);

  // Position bornée (la liste peut rétrécir entre deux `sync`).
  const clampedIndex =
    files.length === 0 ? 0 : Math.min(Math.max(index, 0), files.length - 1);
  const current = files[clampedIndex] ?? null;

  // Miroirs tenus à jour hors render (règle react-hooks/refs), lus par `navigate`.
  useEffect(() => {
    filesRef.current = files;
    indexRef.current = clampedIndex;
  });

  // — Canal : handshake (`hello` en boucle jusqu'au 1er `sync`) + réception —
  useEffect(() => {
    aliveRef.current = true;
    const chan = openProjectionChannel();
    chanRef.current = chan;
    if (!chan) return;

    let ping: ReturnType<typeof setInterval> | null = null;
    const stopPing = () => {
      if (ping) {
        clearInterval(ping);
        ping = null;
      }
    };

    chan.onmessage = (e: MessageEvent<ProjectionMessage>) => {
      const msg = e.data;
      if (msg.type === "sync") {
        stopPing();
        setFiles(msg.files);
        setIndex(msg.index);
      } else if (msg.type === "index") {
        setIndex(msg.index);
      } else if (msg.type === "close") {
        window.close();
      }
    };

    // En temps normal la régie a ouvert cette fenêtre (donc elle écoute déjà) ;
    // on réessaie quand même un court instant pour couvrir toute course.
    chan.postMessage({ type: "hello" } satisfies ProjectionMessage);
    let tries = 0;
    ping = setInterval(() => {
      if (++tries > 30) {
        stopPing();
        return;
      }
      chan.postMessage({ type: "hello" } satisfies ProjectionMessage);
    }, 600);

    return () => {
      aliveRef.current = false;
      stopPing();
      try {
        chan.postMessage({ type: "public-closed" } satisfies ProjectionMessage);
      } catch {
        /* canal déjà fermé */
      }
      chan.close();
      chanRef.current = null;
    };
  }, []);

  // Renvoie la progression du préchargement à la régie (sur changement réel).
  const progressSigRef = useRef("");
  useEffect(() => {
    const chan = chanRef.current;
    if (!chan) return;
    const sig = `${preload.ready}/${preload.total}/${preload.failed}`;
    if (sig === progressSigRef.current) return;
    progressSigRef.current = sig;
    chan.postMessage({
      type: "progress",
      ready: preload.ready,
      total: preload.total,
      failed: preload.failed,
    } satisfies ProjectionMessage);
  }, [preload.ready, preload.total, preload.failed]);

  // Suit l'état plein écran réel.
  useEffect(() => {
    function onFsChange() {
      if (aliveRef.current) setIsFs(fsActive());
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  const goFullscreen = useCallback(() => {
    const el = rootRef.current ?? document.documentElement;
    if (!el || fsActive()) return;
    void enterFs(el);
  }, []);

  const navigate = useCallback((dir: 1 | -1) => {
    const m = filesRef.current.length - 1;
    if (m < 0) return;
    const cur = indexRef.current;
    const ni = dir > 0 ? Math.min(cur + 1, m) : Math.max(cur - 1, 0);
    if (ni === cur) return;
    setIndex(ni);
    chanRef.current?.postMessage({
      type: "index",
      index: ni,
    } satisfies ProjectionMessage);
  }, []);

  // Clavier : ←/→ navigue (et synchronise la régie), F = (re)plein écran.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        navigate(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        goFullscreen();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate, goFullscreen]);

  // Blob préchargé (hors-ligne) si dispo, sinon lecture inline réseau.
  const src = current
    ? (preload.urls.get(current.id) ?? `/api/files/${current.id}?inline=1`)
    : "";

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-0 flex h-screen w-screen items-center justify-center overflow-hidden bg-black"
    >
      {current ? (
        current.mime?.startsWith("image/") ? (
          <FadeImage
            key={current.id}
            src={src}
            alt={current.original_name}
            className="max-h-screen max-w-[100vw] object-contain"
          />
        ) : isVideo(current.mime, current.original_name) ? (
          <video
            key={current.id}
            controls
            autoPlay
            src={src}
            className="max-h-screen max-w-[100vw]"
          />
        ) : isPdf(current.mime, current.original_name) ? (
          <iframe
            key={current.id}
            title={current.original_name}
            src={src}
            className="h-screen w-screen border-0 bg-white"
          />
        ) : isAudio(current.mime, current.original_name) ? (
          <div className="flex w-[90vw] max-w-xl flex-col items-center gap-5">
            <p className="text-balance text-center text-lg text-zinc-100">
              {current.original_name}
            </p>
            <audio
              key={current.id}
              controls
              autoPlay
              src={src}
              className="w-full"
            />
          </div>
        ) : (
          <p className="text-lg text-zinc-300">{current.original_name}</p>
        )
      ) : (
        <p className="text-sm text-zinc-600">En attente de la régie…</p>
      )}

      {/* Invite à passer en plein écran (geste utilisateur requis). Masqué une
          fois en plein écran réel → aucun chrome par-dessus l'image. */}
      {fsSupported && !isFs && (
        <button
          type="button"
          onClick={goFullscreen}
          className="absolute bottom-4 right-4 rounded-lg border border-white/20 bg-black/50 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-black/80"
        >
          Plein écran ⤢
        </button>
      )}
    </div>
  );
}
