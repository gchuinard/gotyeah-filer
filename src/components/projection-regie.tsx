"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  openProjectionChannel,
  type ProjectionMessage,
  type PublicFile,
} from "@/lib/projection-channel";
import { type RemoteMsg } from "@/lib/remote-protocol";
import { PresenterTimer } from "@/components/presenter-timer";
import {
  clockElapsed,
  usePresenterTimer,
  type Clock,
} from "@/lib/use-presenter-timer";
import { AdjustFilter } from "@/components/adjust-filter";
import { isAdjusted, type Adjust } from "@/lib/image-adjust";
import { overwriteMime, renderAdjusted } from "@/lib/render-adjusted";
import { advanceMsToSecs, advanceSecsToMs } from "@/lib/use-file-advance";
import { AutoAdvanceCountdown } from "@/components/auto-advance-countdown";

type Progress = { ready: number; total: number; failed: number };

function isImageFile(f: PublicFile): boolean {
  return !!f.mime?.startsWith("image/");
}

/** Seuil d'inactivité du SSE entrant (ms) au-delà duquel la liaison télécommande
 * est considérée figée (« mort mais ouvert »). > 2× le keep-alive serveur (15 s). */
const STALE_MS = 35000;

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
  note,
  onNote,
  advanceMs,
  onAdvanceMs,
  onClose,
  onEdit,
  onNoteById,
  onRetouched,
  paused = false,
}: {
  files: PublicFile[];
  index: number;
  onIndex: (index: number) => void;
  /** Note (en base) de l'image courante, et son éditeur (cf. `useFileNotes`). */
  note: string;
  onNote: (value: string) => void;
  /** Durée d'auto-avance (ms) de l'image courante + son éditeur (cf. `useFileAdvance`). */
  advanceMs?: number | null;
  onAdvanceMs?: (ms: number | null) => void;
  onClose: () => void;
  /** Ouvre l'éditeur de retouche sur l'image courante (le parent gère la modale). */
  onEdit?: () => void;
  /** Édite la note d'un fichier précis (commande de la télécommande). */
  onNoteById?: (id: string, value: string) => void;
  /** Après un écrasement de retouche lancé depuis la télécommande (rafraîchir les données). */
  onRetouched?: (id: string) => void;
  /** Neutralise le clavier de la régie (ex. pendant l'édition de retouche). */
  paused?: boolean;
}) {
  const [publicOpen, setPublicOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    ready: 0,
    total: 0,
    failed: 0,
  });
  // Cache-bust après écrasement d'une image (« reload ») : rafraîchit l'aperçu
  // de la régie (octets remplacés) — symétrique de la fenêtre publique.
  const [bustMap, setBustMap] = useState<Map<string, number>>(() => new Map());
  // Télécommande (pilotage depuis le téléphone via relais SSE) : code d'appairage
  // (null = inactive) + état « écran noir » (relayé à la fenêtre publique).
  const [remoteCode, setRemoteCode] = useState<string | null>(null);
  const [black, setBlack] = useState(false);
  // Liaison télécommande (SSE entrant) : indicateur + watchdog de liveness. Le SSE
  // de la régie peut se figer « mort mais ouvert » sans onerror → elle cesserait
  // de recevoir les commandes du téléphone SANS aucun signal. `remoteReconnectN`
  // force la recréation du flux.
  const [remoteLink, setRemoteLink] = useState<"connecting" | "live" | "stale">(
    "connecting",
  );
  const [remoteReconnectN, setRemoteReconnectN] = useState(0);
  // Tic qui bumpe à chaque commande reçue → déclenche un push d'état (donc l'envoi
  // de l'`ackSeq`) même quand la commande ne change rien d'observable (ex. goto
  // sur la même image), pour que le téléphone reçoive toujours son accusé.
  const [ackTick, setAckTick] = useState(0);
  // Retouche LIVE venue de la télécommande : réglage appliqué à l'aperçu courant
  // (et rediffusé à la fenêtre publique). Lié à un `id` pour ne pas déborder.
  const [liveAdjust, setLiveAdjust] = useState<{
    id: string;
    adjust: Adjust;
  } | null>(null);
  const regieFilterId = `regie-adjust-${useId().replace(/:/g, "")}`;

  // Chrono du présentateur (état partagé) : la régie l'affiche, le pilote, et en
  // pousse un instantané à la télécommande. Destructuré en locaux (les callbacks
  // sont stables) pour des dépendances d'effet propres.
  const timer = usePresenterTimer(index);
  const {
    total: timerTotal,
    slide: timerSlide,
    running: timerRunning,
    toggle: timerToggle,
    resetAll: timerReset,
    restartSlide: timerRestartSlide,
  } = timer;

  const chanRef = useRef<BroadcastChannel | null>(null);
  const publicWinRef = useRef<Window | null>(null);

  // Miroirs pour des callbacks/listeners stables (pas de re-souscription).
  // Mis à jour dans un effet, jamais pendant le render (règle react-hooks/refs).
  const filesRef = useRef(files);
  const indexRef = useRef(index);
  const onIndexRef = useRef(onIndex);
  const onCloseRef = useRef(onClose);
  const pausedRef = useRef(paused);
  // Miroirs pour la télécommande (lus dans les listeners SSE / le push d'état).
  const codeRef = useRef<string | null>(null);
  const blackRef = useRef(false);
  const remoteClientRef = useRef("");
  const remoteEsRef = useRef<EventSource | null>(null);
  // Instant du dernier message SSE reçu (ping serveur compris) → watchdog régie.
  const lastRemoteMsgRef = useRef(0);
  // Dernier `seq` de commande reçu du téléphone → renvoyé en `ackSeq` (accusé).
  const lastRemoteSeqRef = useRef(0);
  const noteRef = useRef("");
  const totalRef = useRef<Clock>({ base: 0, since: null });
  const slideRef = useRef<Clock>({ base: 0, since: null });
  const runningRef = useRef(false);
  const onNoteByIdRef = useRef(onNoteById);
  const onRetouchedRef = useRef(onRetouched);
  // Garde anti-écrasements concurrents (sérialise les commandes `retouch`).
  const retouchBusyRef = useRef(false);
  useEffect(() => {
    filesRef.current = files;
    indexRef.current = index;
    onIndexRef.current = onIndex;
    onCloseRef.current = onClose;
    pausedRef.current = paused;
    codeRef.current = remoteCode;
    blackRef.current = black;
    noteRef.current = note;
    totalRef.current = timerTotal;
    slideRef.current = timerSlide;
    runningRef.current = timerRunning;
    onNoteByIdRef.current = onNoteById;
    onRetouchedRef.current = onRetouched;
  });
  // Dernière position diffusée : évite l'écho (public → régie → public).
  const lastIdxRef = useRef(-1);

  const max = files.length - 1;
  const current = files[index] ?? null;
  const next = index < max ? files[index + 1] : null;
  // Image courante retouchable ? (image matricielle ; SVG exclu, non pixellisable.)
  const canEditCurrent =
    !!current?.mime?.startsWith("image/") &&
    current.mime !== "image/svg+xml" &&
    !current.original_name.toLowerCase().endsWith(".svg");
  // Filtre de retouche live (depuis la télécommande) appliqué à l'aperçu courant.
  const liveFilterOn =
    !!current &&
    canEditCurrent &&
    !!liveAdjust &&
    liveAdjust.id === current.id &&
    isAdjusted(liveAdjust.adjust);

  // Source d'aperçu (réseau), avec cache-bust si l'image vient d'être écrasée.
  const previewSrc = (id: string) => {
    const v = bustMap.get(id);
    return `/api/files/${id}?inline=1${v != null ? `&v=${v}` : ""}`;
  };

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
        } else if (msg.type === "reload") {
          setBustMap((prev) => new Map(prev).set(msg.id, msg.v));
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
    // Élague le cache-bust des ids disparus (borne la Map). setState dans une
    // fonction imbriquée → satisfait react-hooks/set-state-in-effect.
    const prune = () => {
      const ids = new Set(filesRef.current.map((f) => f.id));
      setBustMap((prev) => {
        const next = new Map([...prev].filter(([k]) => ids.has(k)));
        return next.size === prev.size ? prev : next;
      });
    };
    prune();
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

  // (Re)démarre le chrono « image » à l'ouverture de l'écran public, pour que
  // l'image affichée à ce moment bénéficie de sa PLEINE durée d'auto-avance (sinon
  // un long réglage avant d'ouvrir le projecteur la ferait sauter aussitôt).
  useEffect(() => {
    if (publicOpen) timerRestartSlide();
  }, [publicOpen, timerRestartSlide]);

  // Auto-avance : si l'image courante a une durée (`advanceMs`) et que le chrono
  // « image » tourne, on passe à la suivante quand le temps PASSÉ SUR L'IMAGE
  // atteint la durée. Réutilise `timerSlide` → respecte la pause (pause = on gèle)
  // et se remet à zéro à chaque image. `setTimeout` sur le RESTANT (pas de polling).
  // Ne s'arme qu'une fois l'écran public ouvert (= on projette réellement) ; stop à
  // la dernière image (pas de boucle).
  useEffect(() => {
    if (!publicOpen || !advanceMs || advanceMs <= 0) return;
    if (!timerRunning || index >= max) return;
    const remaining = advanceMs - clockElapsed(timerSlide, Date.now());
    const t = setTimeout(() => go(1), Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [publicOpen, advanceMs, timerRunning, timerSlide, index, max, go]);

  // — Télécommande : pousse l'état courant (image, suivante, position, noir) —
  const pushState = useCallback(() => {
    const code = codeRef.current;
    if (!code) return;
    const fs = filesRef.current;
    const idx = indexRef.current;
    const cur = fs[idx] ?? null;
    const nx = idx < fs.length - 1 ? fs[idx + 1] : null;
    const now = Date.now();
    const editable =
      !!cur?.mime?.startsWith("image/") &&
      cur.mime !== "image/svg+xml" &&
      !cur.original_name.toLowerCase().endsWith(".svg");
    const msg: RemoteMsg = {
      type: "state",
      index: idx,
      total: fs.length,
      current: cur ? { id: cur.id, name: cur.original_name } : null,
      next: nx ? { id: nx.id, name: nx.original_name } : null,
      black: blackRef.current,
      note: noteRef.current,
      timer: {
        totalMs: clockElapsed(totalRef.current, now),
        slideMs: clockElapsed(slideRef.current, now),
        running: runningRef.current,
      },
      editable,
      ackSeq: lastRemoteSeqRef.current,
    };
    fetch("/api/projection/cmd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, from: remoteClientRef.current, msg }),
    }).catch(() => {});
  }, []);

  // Applique une retouche venue de la télécommande : la RÉGIE (laptop, plus
  // puissant) fait le rendu canvas + l'écrasement (PUT), puis rafraîchit le
  // projecteur (reload + retrait du filtre live) et la régie, et resynchronise.
  const applyRetouch = useCallback(
    async (id: string, adjust: Adjust) => {
      if (retouchBusyRef.current) return; // sérialise (pas d'écrasements concurrents)
      const f = filesRef.current.find((x) => x.id === id);
      if (!f) return;
      retouchBusyRef.current = true;
      const outMime = overwriteMime(f);
      const bust = Date.now();
      let ok = false;
      try {
        const blob = await renderAdjusted(
          id,
          adjust,
          outMime,
          outMime === "image/jpeg" ? 0.92 : undefined,
          bust,
        );
        const res = await fetch(`/api/files/${id}`, {
          method: "PUT",
          headers: { "content-type": outMime },
          body: blob,
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      // On retire TOUJOURS le filtre live (succès → octets bakés via reload ;
      // échec → on revient à l'original). Sans ça, un échec laisserait le filtre
      // collé sur le projecteur alors que l'image n'a pas changé.
      if (ok) {
        chanRef.current?.postMessage({
          type: "reload",
          id,
          v: bust,
        } satisfies ProjectionMessage);
        setBustMap((prev) => new Map(prev).set(id, bust));
        onRetouchedRef.current?.(id);
      }
      chanRef.current?.postMessage({
        type: "adjust",
        id,
        adjust: null,
      } satisfies ProjectionMessage);
      setLiveAdjust(null);
      // Informe la télécommande du résultat (elle garde le panneau ouvert en attente).
      const code = codeRef.current;
      if (code) {
        fetch("/api/projection/cmd", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            from: remoteClientRef.current,
            msg: { type: "retouch-done", ok } satisfies RemoteMsg,
          }),
        }).catch(() => {});
      }
      pushState();
      retouchBusyRef.current = false;
    },
    [pushState],
  );

  // Reçoit les commandes du téléphone (SSE) : navigation + écran noir + retouche.
  useEffect(() => {
    if (!remoteCode) return;
    lastRemoteMsgRef.current = Date.now();
    const es = new EventSource(`/api/projection/stream?code=${remoteCode}`);
    remoteEsRef.current = es;
    es.onopen = () => {
      lastRemoteMsgRef.current = Date.now();
    };
    es.onerror = () => setRemoteLink("stale");
    es.onmessage = (e) => {
      lastRemoteMsgRef.current = Date.now();
      setRemoteLink("live");
      let msg: {
        type?: string;
        clientId?: string;
        dir?: 1 | -1;
        index?: number;
        on?: boolean;
        id?: string;
        value?: string;
        action?: string;
        adjust?: Adjust | null;
        seq?: number;
      };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "ping") return; // keep-alive de liveness (rien à appliquer)
      // Accusé de réception : mémorise le dernier seq reçu et force un push d'état
      // (via ackTick) pour le renvoyer au téléphone, même si la commande ne change
      // rien d'observable (sinon l'effet « push au changement » ne se déclencherait pas).
      if (typeof msg.seq === "number") {
        lastRemoteSeqRef.current = Math.max(lastRemoteSeqRef.current, msg.seq);
        setAckTick((t) => t + 1);
      }
      if (msg.type === "hello") {
        remoteClientRef.current = msg.clientId ?? "";
        pushState();
      } else if (msg.type === "go") {
        go(msg.dir === -1 ? -1 : 1);
      } else if (msg.type === "goto" && typeof msg.index === "number") {
        const m = filesRef.current.length - 1;
        if (m >= 0) onIndexRef.current(Math.min(Math.max(msg.index, 0), m));
      } else if (msg.type === "black") {
        setBlack(!!msg.on);
      } else if (
        msg.type === "note" &&
        typeof msg.id === "string" &&
        typeof msg.value === "string"
      ) {
        onNoteByIdRef.current?.(msg.id, msg.value);
      } else if (msg.type === "timer") {
        if (msg.action === "toggle") timerToggle();
        else if (msg.action === "reset") timerReset();
      } else if (msg.type === "adjust" && typeof msg.id === "string") {
        // Réglage live → rediffusé à la fenêtre publique + appliqué à l'aperçu régie.
        const a = msg.adjust ?? null;
        const id = msg.id;
        setLiveAdjust(a ? { id, adjust: a } : null);
        chanRef.current?.postMessage({
          type: "adjust",
          id,
          adjust: a,
        } satisfies ProjectionMessage);
      } else if (
        msg.type === "retouch" &&
        typeof msg.id === "string" &&
        msg.adjust
      ) {
        void applyRetouch(msg.id, msg.adjust);
      } else if (msg.type === "request-state") {
        pushState();
      }
    };
    return () => {
      es.close();
      remoteEsRef.current = null;
    };
  }, [
    remoteCode,
    go,
    pushState,
    timerToggle,
    timerReset,
    applyRetouch,
    remoteReconnectN,
  ]);

  // Watchdog de liveness côté régie : son SSE entrant peut se figer « mort mais
  // ouvert » (veille laptop, proxy) SANS onerror → elle cesserait de recevoir les
  // commandes du téléphone sans aucun signal. Si rien reçu (ping serveur compris)
  // depuis trop longtemps, on marque la liaison figée + on force une reconnexion.
  useEffect(() => {
    if (!remoteCode) return;
    const id = setInterval(() => {
      if (Date.now() - lastRemoteMsgRef.current > STALE_MS) {
        setRemoteLink("stale");
        remoteEsRef.current?.close();
        setRemoteReconnectN((n) => n + 1);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [remoteCode]);

  // Heartbeat d'état : pousse périodiquement l'état même SANS changement, pour que
  // le repli polling du téléphone (qui lit le dernier état mémorisé côté serveur)
  // reste à jour pendant un passage statique du spectacle. Garde anti-écho : on
  // n'émet qu'une fois le clientId posé (sinon le push partirait avec from="").
  useEffect(() => {
    if (!remoteCode) return;
    const id = setInterval(() => {
      if (remoteClientRef.current) pushState();
    }, 10000);
    return () => clearInterval(id);
  }, [remoteCode, pushState]);

  // Pousse l'état au téléphone à chaque changement (position / liste / noir).
  // Attend que le `hello` SSE ait posé le clientId — sinon le push partirait avec
  // from="" et serait rediffusé à TOUT le monde (la régie incluse → écho). Le
  // `hello` pousse déjà le 1er état ; cet effet ne couvre que les changements suivants.
  useEffect(() => {
    if (!remoteCode || !remoteClientRef.current) return;
    pushState();
  }, [
    remoteCode,
    index,
    filesKey,
    black,
    note,
    timerTotal,
    timerSlide,
    timerRunning,
    ackTick,
    pushState,
  ]);

  // Relaie l'écran noir à la fenêtre publique (BroadcastChannel).
  useEffect(() => {
    chanRef.current?.postMessage({
      type: "black",
      on: black,
    } satisfies ProjectionMessage);
  }, [black]);

  // Clavier : ←/→ navigue, Échap quitte le mode présentateur. Inactif pendant
  // la saisie des notes (sinon les flèches déplaceraient le curseur ET l'image).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Édition de retouche en cours (modale par-dessus la régie) → on rend la
      // main au clavier de la modale (sinon ←/→ navigueraient, Échap quitterait).
      if (pausedRef.current) return;
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
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setBlack((v) => !v);
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
    try {
      // Donne le focus à la fenêtre fraîche → la touche F (plein écran) marche
      // tout de suite, sans devoir cliquer dedans d'abord.
      win.focus();
    } catch {
      /* fenêtre déjà fermée */
    }
    setBlocked(false);
    setPublicOpen(true);
    // Sync proactif (en plus du `hello` émis par la fenêtre à son chargement).
    chanRef.current?.postMessage({
      type: "sync",
      files: filesRef.current,
      index: indexRef.current,
    } satisfies ProjectionMessage);
  }

  function activateRemote() {
    // Code d'appairage à 4 chiffres (Math.random dans un handler : hors render, OK).
    setRemoteCode(String(Math.floor(1000 + Math.random() * 9000)));
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
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black">
          {onEdit && current && canEditCurrent && (
            <button
              type="button"
              onClick={onEdit}
              className="absolute right-3 top-3 z-10 rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-sm text-zinc-100 backdrop-blur-sm transition-colors hover:bg-black/80"
            >
              Retoucher ✎
            </button>
          )}
          {black && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/80 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Écran noir
            </div>
          )}
          {/* Décompte d'auto-avance en overlay (coin haut-gauche ; n'apparaît que
              quand l'auto-avance est armée). pointer-events-none : ne gêne rien. */}
          <div className="pointer-events-none absolute left-3 top-3 z-10">
            <AutoAdvanceCountdown
              advanceMs={advanceMs}
              slide={timerSlide}
              running={timerRunning}
              active={publicOpen && index < max}
              variant="badge"
            />
          </div>
          {liveFilterOn && liveAdjust && (
            <AdjustFilter a={liveAdjust.adjust} id={regieFilterId} />
          )}
          {current ? (
            isImageFile(current) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewSrc(current.id)}
                alt={current.original_name}
                className="max-h-full max-w-full object-contain"
                style={
                  liveFilterOn
                    ? { filter: `url(#${regieFilterId})` }
                    : undefined
                }
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

          {/* Télécommande (piloter depuis le téléphone) */}
          <div className="rounded-xl border border-zinc-800 p-3">
            {!remoteCode ? (
              <>
                <button
                  type="button"
                  onClick={activateRemote}
                  className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
                >
                  📱 Activer la télécommande
                </button>
                <p className="mt-2 text-xs text-zinc-500">
                  Pilote la projection (◀ ▶, écran noir) depuis ton téléphone.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-zinc-500">Télécommande</p>
                <p className="mt-1 text-sm text-zinc-300">
                  Sur ton téléphone (même connexion admin), ouvre{" "}
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-200">
                    …/admin/remote
                  </span>{" "}
                  et tape le code :
                </p>
                <p className="my-2 text-center text-3xl font-semibold tracking-[0.3em] tabular-nums text-zinc-100">
                  {remoteCode}
                </p>
                <p
                  className={`mb-2 flex items-center justify-center gap-1.5 text-[11px] ${
                    remoteLink === "live" ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      remoteLink === "live" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {remoteLink === "live" ? "Canal connecté" : "Reconnexion du canal…"}
                </p>
                <button
                  type="button"
                  onClick={() => setRemoteCode(null)}
                  className="w-full rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-900"
                >
                  Désactiver
                </button>
              </>
            )}
          </div>

          {/* Chrono */}
          <PresenterTimer
            total={timerTotal}
            slide={timerSlide}
            running={timerRunning}
            onToggle={timerToggle}
            onReset={timerReset}
          />

          {/* Notes — bloc-notes local (par image, sur ce navigateur) */}
          <div className="rounded-xl border border-zinc-800 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-500">Notes</p>
            <textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              disabled={!current}
              placeholder={
                current ? "Notes pour cette image (enregistrées)…" : "—"
              }
              className="h-28 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
            />
          </div>

          {/* Avance auto (par image, persistée en base) : passe à la suivante
              automatiquement après ce délai pendant la projection. */}
          <div className="rounded-xl border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-zinc-500">Avance auto</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  disabled={!current || !onAdvanceMs}
                  value={advanceMsToSecs(advanceMs ?? null)}
                  onChange={(e) =>
                    onAdvanceMs?.(advanceSecsToMs(e.target.value))
                  }
                  placeholder="—"
                  className="w-16 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm tabular-nums text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
                />
                <span className="text-xs text-zinc-500">s</span>
              </div>
            </div>
            <AutoAdvanceCountdown
              advanceMs={advanceMs}
              slide={timerSlide}
              running={timerRunning}
              active={publicOpen && index < max}
            >
              <p className="mt-1 text-[11px] text-zinc-600">
                Vide = manuel. Sinon passe à l&apos;image suivante après ce délai
                (écran public ouvert ; en pause, le décompte se fige).
              </p>
            </AutoAdvanceCountdown>
          </div>

          {/* Image suivante */}
          <div className="rounded-xl border border-zinc-800 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-500">Suivante</p>
            {next ? (
              <div className="flex items-center gap-3">
                {isImageFile(next) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewSrc(next.id)}
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
            ←/→ naviguer · B écran noir · Échap quitter
          </p>
        </div>
      </div>
    </div>
  );
}
