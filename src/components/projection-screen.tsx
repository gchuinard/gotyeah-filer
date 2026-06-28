"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isAudio, isPdf, isVideo } from "@/lib/media";
import { fsActive, fsEnabled, enterFs } from "@/lib/fullscreen";
import { FadeImage } from "@/components/fade-image";
import { AdjustFilter } from "@/components/adjust-filter";
import { isAdjusted, type Adjust } from "@/lib/image-adjust";
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
  // Réglage de retouche LIVE (diffusé par l'éditeur en mode présentateur) : on
  // applique le filtre SVG à l'image courante en temps réel. Lié à un `id` pour
  // ne pas « déborder » si l'image change pendant l'édition.
  const [liveAdjust, setLiveAdjust] = useState<{
    id: string;
    adjust: Adjust;
  } | null>(null);
  // Cache-bust après écrasement (« reload ») : force le rechargement des octets
  // frais, en contournant le blob préchargé (figé) et le cache HTTP.
  const [bustMap, setBustMap] = useState<Map<string, number>>(() => new Map());
  // Écran noir (commandé par la régie / la télécommande) : coupe l'image.
  const [black, setBlack] = useState(false);
  const filterId = `proj-${useId().replace(/:/g, "")}`;

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
        // Élague le cache-bust des ids qui ne sont plus dans la liste (borne la Map).
        const ids = new Set(msg.files.map((f) => f.id));
        setBustMap((prev) => {
          const next = new Map([...prev].filter(([k]) => ids.has(k)));
          return next.size === prev.size ? prev : next;
        });
      } else if (msg.type === "index") {
        setIndex(msg.index);
      } else if (msg.type === "adjust") {
        setLiveAdjust(msg.adjust ? { id: msg.id, adjust: msg.adjust } : null);
      } else if (msg.type === "reload") {
        setBustMap((prev) => new Map(prev).set(msg.id, msg.v));
      } else if (msg.type === "black") {
        setBlack(msg.on);
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

  // Source de l'image courante : après un écrasement (« reload »), on force les
  // octets frais via un cache-bust (qui contourne aussi le blob préchargé figé) ;
  // sinon blob préchargé (hors-ligne) si dispo, sinon lecture inline réseau.
  const bust = current ? bustMap.get(current.id) : undefined;
  const src = !current
    ? ""
    : bust != null
      ? `/api/files/${current.id}?inline=1&v=${bust}`
      : (preload.urls.get(current.id) ?? `/api/files/${current.id}?inline=1`);

  // Filtre de retouche LIVE actif uniquement si le réglage vise l'image courante.
  const filterOn =
    !!current &&
    !!current.mime?.startsWith("image/") &&
    !!liveAdjust &&
    liveAdjust.id === current.id &&
    isAdjusted(liveAdjust.adjust);

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-0 flex h-screen w-screen items-center justify-center overflow-hidden bg-black ${isFs ? "cursor-none" : ""}`}
    >
      {filterOn && liveAdjust && (
        <AdjustFilter a={liveAdjust.adjust} id={filterId} />
      )}
      {/* Écran noir : coupe tout (au-dessus de l'image et de l'invite plein écran). */}
      {black && <div className="absolute inset-0 z-20 bg-black" />}
      {current ? (
        current.mime?.startsWith("image/") ? (
          <FadeImage
            key={current.id}
            src={src}
            alt={current.original_name}
            className="max-h-screen max-w-[100vw] object-contain"
            style={filterOn ? { filter: `url(#${filterId})` } : undefined}
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

      {/* Invite à passer en plein écran (geste utilisateur requis). TOUTE la
          fenêtre est cliquable : l'opérateur ne voit pas le projecteur → il ne
          doit pas viser un petit bouton, un clic n'importe où sur cet écran
          suffit. Masqué une fois en plein écran réel → aucun chrome sur l'image. */}
      {fsSupported && !isFs && (
        <button
          type="button"
          onClick={goFullscreen}
          aria-label="Passer en plein écran"
          className="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center bg-black/30 text-center transition-colors hover:bg-black/20"
        >
          <span className="rounded-2xl border border-white/15 bg-black/70 px-6 py-4 shadow-2xl">
            <span className="block text-2xl font-semibold text-zinc-100 sm:text-3xl">
              ▶ Cliquez pour projeter en plein écran
            </span>
            <span className="mt-1 block text-sm text-zinc-300">
              Cliquez n&apos;importe où sur cet écran · ou touche F
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
