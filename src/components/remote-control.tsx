"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type RemoteFile,
  type RemoteMsg,
  type RemoteState,
  type RemoteTimer,
} from "@/lib/remote-protocol";
import { AdjustFilter } from "@/components/adjust-filter";
import {
  isAdjusted,
  SLIDERS,
  ZERO_ADJUST,
  type Adjust,
} from "@/lib/image-adjust";

/** Formate une durée en h:mm:ss (heures masquées si nulles). */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Seuil d'inactivité SSE (ms) au-delà duquel on considère le flux figé (« mort
 * mais ouvert »). Doit rester > 2× l'intervalle de keep-alive serveur (15 s)
 * pour éviter les faux positifs sur réseau lent. */
const STALE_MS = 35000;

/**
 * Télécommande de projection (page `/admin/remote`, à ouvrir sur le téléphone).
 * Code d'appairage → puis pilotage : ◀ ▶, écran noir, **chrono** (affiché +
 * pause/reprise/reset) et **note** de l'image courante (éditable, persistée en
 * base). Le chrono reçu est un instantané EXTRAPOLÉ localement (tique tout seul,
 * sans décalage d'horloge entre appareils).
 */
export function RemoteControl() {
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [conn, setConn] = useState<"connecting" | "open" | "error">(
    "connecting",
  );
  // Liveness : un SSE « figé mais ouvert » ne déclenche pas onerror. On mesure
  // l'âge du dernier message reçu (ping serveur compris) → `stale` arme le repli
  // polling ET force une reconnexion même sans onerror ; `reconnectN` recrée le flux.
  const [stale, setStale] = useState(false);
  const [reconnectN, setReconnectN] = useState(0);
  const [state, setState] = useState<RemoteState | null>(null);
  // Édition locale de la note (prime sur la valeur serveur, par id d'image).
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  // Instant courant pour faire tiquer le chrono extrapolé.
  const [now, setNow] = useState(() => Date.now());
  // Instant (horloge du téléphone) de réception du dernier instantané chrono.
  const [timerRecvAt, setTimerRecvAt] = useState(0);
  // Retouche depuis le téléphone (aperçu live projeté via la régie).
  const [retouching, setRetouching] = useState(false);
  const [radjust, setRadjust] = useState<Adjust>(ZERO_ADJUST);
  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [retouchError, setRetouchError] = useState<string | null>(null);
  // Image cible FIGÉE à l'ouverture du panneau : la projection peut changer (SSE)
  // pendant qu'on retouche → on reste lié à CETTE image (sinon on écraserait la mauvaise).
  const [retouchTarget, setRetouchTarget] = useState<RemoteFile | null>(null);
  const phoneFilterId = `radjust-${useId().replace(/:/g, "")}`;

  const clientRef = useRef("");
  const codeRef = useRef("");
  const esRef = useRef<EventSource | null>(null);
  // Instant du dernier message SSE reçu (ping serveur compris) → watchdog de liveness.
  const lastMsgRef = useRef(0);
  // Note en attente d'envoi (debounce + flush au démontage).
  const pendingNote = useRef<{ id: string; value: string } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Throttle d'envoi du réglage live (au plus ~8×/s, dernière valeur).
  const adjustSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestAdjustRef = useRef<Adjust>(ZERO_ADJUST);
  // Filet de sécurité si la régie ne renvoie pas le résultat de l'écrasement.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dernier instantané chrono appliqué : ne ré-ancrer l'extrapolation que s'il
  // change (sinon un poll répété d'un état périmé ferait sauter le chrono).
  const timerSnapRef = useRef<RemoteTimer | null>(null);

  const send = useCallback((msg: RemoteMsg) => {
    fetch("/api/projection/cmd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: codeRef.current,
        from: clientRef.current,
        msg,
      }),
    }).catch(() => {});
  }, []);

  // Applique un état reçu (par SSE ou par le repli polling).
  const applyState = useCallback((s: Partial<RemoteState>) => {
    const tmr = s.timer ?? { totalMs: 0, slideMs: 0, running: false };
    // Ré-ancrer l'extrapolation du chrono UNIQUEMENT si l'instantané a changé :
    // sinon un poll répété (état périmé) ferait reculer le chrono toutes les 2,5 s.
    const prev = timerSnapRef.current;
    const timerChanged =
      !prev ||
      prev.totalMs !== tmr.totalMs ||
      prev.slideMs !== tmr.slideMs ||
      prev.running !== tmr.running;
    if (timerChanged) {
      timerSnapRef.current = tmr;
      const t = Date.now();
      setTimerRecvAt(t);
      setNow(t);
    }
    setState({
      index: s.index ?? 0,
      total: s.total ?? 0,
      current: s.current ?? null,
      next: s.next ?? null,
      black: !!s.black,
      note: s.note ?? "",
      timer: tmr,
      editable: !!s.editable,
    });
  }, []);

  // Connexion SSE (réception de l'état) une fois le code saisi.
  useEffect(() => {
    if (!joined) return;
    lastMsgRef.current = Date.now(); // base de fraîcheur dès l'ouverture du flux
    const es = new EventSource(`/api/projection/stream?code=${codeRef.current}`);
    esRef.current = es;
    es.onopen = () => {
      lastMsgRef.current = Date.now();
      setConn("open");
    };
    es.onmessage = (e) => {
      lastMsgRef.current = Date.now();
      setStale(false);
      let msg: { type?: string; clientId?: string; ok?: boolean } & Partial<RemoteState>;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "ping") return; // keep-alive de liveness (rien à appliquer)
      if (msg.type === "hello") {
        clientRef.current = msg.clientId ?? "";
        send({ type: "request-state" });
      } else if (msg.type === "retouch-done") {
        // Résultat de l'écrasement : succès → on ferme ; échec → on garde le panneau.
        if (commitTimer.current) {
          clearTimeout(commitTimer.current);
          commitTimer.current = null;
        }
        if (msg.ok) {
          // La régie a déjà retiré le filtre + rafraîchi → on ferme (setters stables).
          setRetouching(false);
          setConfirming(false);
          setCommitting(false);
          setRetouchTarget(null);
        } else {
          setCommitting(false);
          setRetouchError("Échec de l'écrasement. Réessaie.");
        }
      } else if (msg.type === "state") {
        applyState(msg);
      }
    };
    es.onerror = () => setConn("error"); // EventSource se reconnecte tout seul.
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [joined, send, applyState, reconnectN]);

  // Repli polling : si le flux SSE est dégradé (pas « open »), on va chercher le
  // dernier état en HTTP simple (qui passe quand le SSE est coincé) → l'affichage
  // ne gèle plus. Le temps réel reprend dès que le SSE redevient « open ».
  useEffect(() => {
    // Polling actif si le SSE n'est pas « open » OU s'il est figé (`stale`) : un
    // SSE « mort mais ouvert » resterait 'open' sans rien livrer → on le couvre.
    if (!joined || (conn === "open" && !stale)) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/projection/state?code=${codeRef.current}`);
        if (!res.ok || !alive) return;
        const text = await res.text();
        if (!text || !alive) return;
        const s = JSON.parse(text) as { type?: string } & Partial<RemoteState>;
        if (s.type === "state") applyState(s);
      } catch {
        /* réseau KO — on retentera au prochain tick */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [joined, conn, stale, applyState]);

  // Watchdog de liveness : un SSE figé ne déclenche pas onerror. Si rien n'est
  // reçu (ping serveur compris) depuis trop longtemps, on le considère mort →
  // `stale` (arme le polling) + reconnexion forcée (pour repartir sur une socket
  // TCP neuve, la reconnexion native ne se déclenchant pas sur un half-open).
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(() => {
      if (Date.now() - lastMsgRef.current > STALE_MS) {
        setStale(true);
        esRef.current?.close();
        setReconnectN((n) => n + 1);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [joined]);

  // Retour au premier plan / réseau : le téléphone en veille fige le SSE sans
  // onerror. Au réveil on resynchronise tout de suite (request-state) et, si le
  // flux semble figé, on force une reconnexion sans attendre le watchdog.
  useEffect(() => {
    if (!joined) return;
    const forceReconnect = () => {
      setStale(true);
      esRef.current?.close();
      setReconnectN((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      send({ type: "request-state" });
      if (Date.now() - lastMsgRef.current > 4000) forceReconnect();
    };
    const onOnline = () => {
      send({ type: "request-state" });
      forceReconnect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [joined, send]);

  // Tique chaque seconde tant que le chrono tourne (affichage extrapolé).
  const running = state?.timer.running ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Flush de la note en attente au démontage (ne rien perdre si on ferme).
  useEffect(() => {
    return () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
      if (adjustSendTimer.current) clearTimeout(adjustSendTimer.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
      const p = pendingNote.current;
      if (p) send({ type: "note", id: p.id, value: p.value });
    };
  }, [send]);

  function onNoteChange(value: string) {
    const id = state?.current?.id;
    if (!id) return;
    setNoteEdits((e) => ({ ...e, [id]: value }));
    pendingNote.current = { id, value };
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      const p = pendingNote.current;
      if (p) {
        send({ type: "note", id: p.id, value: p.value });
        pendingNote.current = null;
      }
    }, 500);
  }

  // Envoi throttlé du réglage live (trailing : au plus ~8×/s, toujours la dernière valeur).
  function sendAdjustThrottled(id: string, a: Adjust) {
    latestAdjustRef.current = a;
    if (adjustSendTimer.current) return;
    adjustSendTimer.current = setTimeout(() => {
      adjustSendTimer.current = null;
      send({ type: "adjust", id, adjust: latestAdjustRef.current });
    }, 120);
  }

  function openRetouch() {
    const cur = state?.current ?? null;
    if (!cur?.id) return;
    setRetouchTarget(cur); // image FIGÉE pour toute la session de retouche
    setRadjust(ZERO_ADJUST);
    setConfirming(false);
    setCommitting(false);
    setRetouchError(null);
    setRetouching(true);
  }

  function closeRetouch(revert: boolean) {
    if (adjustSendTimer.current) {
      clearTimeout(adjustSendTimer.current);
      adjustSendTimer.current = null;
    }
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    const id = retouchTarget?.id;
    // « Fermer/Annuler » : on retire le filtre du projecteur (retour à l'original).
    // Après un écrasement, c'est la régie qui retire le filtre (post-PUT) → pas ici.
    if (revert && id) send({ type: "adjust", id, adjust: null });
    setRetouching(false);
    setConfirming(false);
    setCommitting(false);
    setRetouchTarget(null);
  }

  function onSlider(key: keyof Adjust, value: number) {
    const id = retouchTarget?.id;
    const next = { ...radjust, [key]: value };
    setRadjust(next);
    if (id) sendAdjustThrottled(id, next);
  }

  function resetAdjust() {
    const id = retouchTarget?.id;
    setRadjust(ZERO_ADJUST);
    if (id) sendAdjustThrottled(id, ZERO_ADJUST); // identité → projecteur revient à l'original
  }

  function doOverwrite() {
    const id = retouchTarget?.id;
    if (!id) return;
    setConfirming(false);
    setRetouchError(null);
    setCommitting(true);
    send({ type: "retouch", id, adjust: radjust });
    // Filet de sécurité si la régie ne répond pas (onglet fermé…) : rendre la main.
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      setCommitting(false);
      setRetouchError("Pas de réponse de la régie. Réessaie.");
    }, 40000);
  }

  if (!joined) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <div className="w-full max-w-xs">
          <h1 className="mb-1 text-center text-xl font-semibold">Télécommande</h1>
          <p className="mb-6 text-center text-sm text-zinc-500">
            Saisis le code affiché dans la régie.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{4,6}$/.test(code)) {
                codeRef.current = code;
                setJoined(true);
              }
            }}
            className="flex flex-col gap-3"
          >
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="Code"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-center text-2xl tracking-[0.4em] tabular-nums text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={!/^\d{4,6}$/.test(code)}
              className="rounded-xl bg-zinc-100 px-4 py-3 text-base font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
            >
              Connecter
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (retouching) {
    const cur = retouchTarget;
    const dirty = isAdjusted(radjust);
    return (
      <main className="flex min-h-dvh flex-col bg-zinc-950 p-4 text-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">Retoucher (projeté en direct)</span>
          <button
            type="button"
            onClick={() => closeRetouch(true)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors active:bg-zinc-900"
          >
            Fermer ✕
          </button>
        </div>

        <AdjustFilter a={radjust} id={phoneFilterId} />
        <div className="mb-3 flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black">
          {cur?.id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${cur.id}?inline=1`}
              alt={cur.name}
              style={{ filter: `url(#${phoneFilterId})` }}
              className="max-h-[42vh] max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-zinc-600">Aucune image</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {SLIDERS.map((s) => (
            <label key={s.key} className="flex flex-col gap-0.5">
              <span className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>{s.label}</span>
                <span className="tabular-nums text-zinc-500">
                  {radjust[s.key] > 0 ? `+${radjust[s.key]}` : radjust[s.key]}
                </span>
              </span>
              <input
                type="range"
                min={-100}
                max={100}
                value={radjust[s.key]}
                disabled={committing}
                onChange={(e) => onSlider(s.key, Number(e.target.value))}
                className="w-full accent-zinc-300 disabled:opacity-50"
              />
            </label>
          ))}
        </div>

        <div className="mt-4">
          {committing ? (
            <p className="rounded-xl border border-zinc-800 px-4 py-3 text-center text-sm text-zinc-400">
              Enregistrement…
            </p>
          ) : !confirming ? (
            <>
              {retouchError && (
                <p className="mb-2 text-center text-sm text-red-400">
                  {retouchError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!dirty}
                  onClick={resetAdjust}
                  className="rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-200 transition-colors active:bg-zinc-900 disabled:opacity-40"
                >
                  Réinitialiser
                </button>
                <button
                  type="button"
                  disabled={!dirty}
                  onClick={() => setConfirming(true)}
                  className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:border-red-900 active:bg-zinc-900 disabled:opacity-40"
                >
                  Écraser l&apos;original
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-red-900 bg-red-950/40 p-3">
              <p className="mb-2 text-center text-sm text-zinc-200">
                Écraser définitivement l&apos;original ? (irréversible)
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={doOverwrite}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
                >
                  Écraser
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  const black = state?.black ?? false;
  // « Vivant » = SSE open ET non figé (un half-open reste 'open' mais muet).
  const live = conn === "open" && !stale;
  const pos = state
    ? `${Math.min(state.index + 1, state.total)} / ${state.total}`
    : "—";
  const curId = state?.current?.id ?? null;
  const noteValue =
    curId && noteEdits[curId] !== undefined
      ? noteEdits[curId]
      : (state?.note ?? "");
  // Chrono extrapolé : on ajoute le temps écoulé depuis la réception si ça tourne.
  const snap = state?.timer ?? { totalMs: 0, slideMs: 0, running: false };
  const extra = snap.running ? Math.max(0, now - timerRecvAt) : 0;
  const totalMs = snap.totalMs + extra;
  const slideMs = snap.slideMs + extra;

  return (
    <main className="flex min-h-dvh flex-col bg-zinc-950 p-4 text-zinc-100">
      {/* En-tête : position + état de connexion */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm tabular-nums text-zinc-400">{pos}</span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span
            className={`size-2 rounded-full ${
              live
                ? "bg-emerald-500"
                : conn === "error" || stale
                  ? "bg-red-500"
                  : "bg-amber-500"
            }`}
          />
          {live
            ? "connecté"
            : conn === "error" || stale
              ? "reconnexion…"
              : "connexion…"}
        </span>
      </div>

      {/* Zone défilante : chrono + suivante + note */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {/* Chrono */}
        <div className="rounded-xl border border-zinc-800 p-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="font-mono text-3xl tabular-nums text-zinc-100">
                {fmt(totalMs)}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">
                total
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xl tabular-nums text-zinc-400">
                {fmt(slideMs)}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">
                image
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => send({ type: "timer", action: "toggle" })}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition-colors active:bg-zinc-900"
            >
              {snap.running ? "Pause" : "Reprendre"}
            </button>
            <button
              type="button"
              onClick={() => send({ type: "timer", action: "reset" })}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition-colors active:bg-zinc-900"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Vignette de l'image suivante */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Suivante
          </span>
          {state?.next?.id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${state.next.id}?inline=1`}
              alt={state.next.name}
              className="max-h-[28vh] max-w-full rounded-xl border border-zinc-800 object-contain"
            />
          ) : (
            <p className="text-sm text-zinc-600">— fin —</p>
          )}
        </div>

        {/* Note de l'image courante (éditable, persistée en base) */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500">Note</p>
          <textarea
            value={noteValue}
            onChange={(e) => onNoteChange(e.target.value)}
            disabled={!curId}
            placeholder={curId ? "Note pour cette image…" : "—"}
            className="h-24 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
          />
        </div>
      </div>

      {/* Retouche (aperçu projeté en direct) — seulement sur une image */}
      {state?.editable && (
        <button
          type="button"
          onClick={openRetouch}
          className="mb-3 rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-200 transition-colors active:bg-zinc-900"
        >
          Retoucher l&apos;image ✎
        </button>
      )}

      {/* Écran noir */}
      <button
        type="button"
        onClick={() => send({ type: "black", on: !black })}
        className={`mb-3 mt-4 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
          black
            ? "border-amber-700 bg-amber-950 text-amber-300"
            : "border-zinc-700 text-zinc-300 hover:bg-zinc-900"
        }`}
      >
        {black ? "Écran noir actif — toucher pour rétablir" : "Écran noir"}
      </button>

      {/* Navigation : grosses cibles tactiles */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => send({ type: "go", dir: -1 })}
          aria-label="Précédent"
          className="rounded-2xl border border-zinc-700 py-7 text-3xl font-semibold text-zinc-100 transition-colors active:bg-zinc-900"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => send({ type: "go", dir: 1 })}
          aria-label="Suivant"
          className="rounded-2xl bg-zinc-100 py-7 text-3xl font-semibold text-zinc-900 transition-colors active:bg-white"
        >
          ▶
        </button>
      </div>
    </main>
  );
}
