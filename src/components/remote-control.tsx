"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type RemoteMsg, type RemoteState } from "@/lib/remote-protocol";

/**
 * Télécommande de projection (page `/admin/remote`, à ouvrir sur le téléphone).
 * On saisit le code affiché par la régie, puis on pilote : ◀ / ▶ et écran noir.
 * Affiche la position et la VIGNETTE de l'image suivante (état reçu en SSE).
 */
export function RemoteControl() {
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [conn, setConn] = useState<"connecting" | "open" | "error">(
    "connecting",
  );
  const [state, setState] = useState<RemoteState | null>(null);

  const clientRef = useRef("");
  const codeRef = useRef("");

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

  useEffect(() => {
    if (!joined) return;
    // (l'état initial est déjà "connecting" ; onopen/onerror prennent le relais)
    const es = new EventSource(`/api/projection/stream?code=${codeRef.current}`);
    es.onopen = () => setConn("open");
    es.onmessage = (e) => {
      let msg: { type?: string; clientId?: string } & Partial<RemoteState>;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "hello") {
        clientRef.current = msg.clientId ?? "";
        send({ type: "request-state" });
      } else if (msg.type === "state") {
        setState({
          index: msg.index ?? 0,
          total: msg.total ?? 0,
          current: msg.current ?? null,
          next: msg.next ?? null,
          black: !!msg.black,
        });
      }
    };
    es.onerror = () => setConn("error"); // EventSource se reconnecte tout seul.
    return () => es.close();
  }, [joined, send]);

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

  const black = state?.black ?? false;
  const pos = state
    ? `${Math.min(state.index + 1, state.total)} / ${state.total}`
    : "—";

  return (
    <main className="flex min-h-dvh flex-col bg-zinc-950 p-4 text-zinc-100">
      {/* En-tête : position + état de connexion */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm tabular-nums text-zinc-400">{pos}</span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span
            className={`size-2 rounded-full ${
              conn === "open"
                ? "bg-emerald-500"
                : conn === "error"
                  ? "bg-red-500"
                  : "bg-amber-500"
            }`}
          />
          {conn === "open"
            ? "connecté"
            : conn === "error"
              ? "reconnexion…"
              : "connexion…"}
        </span>
      </div>

      {/* Vignette de l'image suivante */}
      <div className="mb-4 flex flex-1 flex-col items-center justify-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Suivante
        </span>
        {state?.next?.id ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${state.next.id}?inline=1`}
            alt={state.next.name}
            className="max-h-[40vh] max-w-full rounded-xl border border-zinc-800 object-contain"
          />
        ) : (
          <p className="text-sm text-zinc-600">— fin —</p>
        )}
        {state?.next && (
          <p className="max-w-full truncate px-4 text-center text-xs text-zinc-500">
            {state.next.name}
          </p>
        )}
      </div>

      {/* Écran noir */}
      <button
        type="button"
        onClick={() => send({ type: "black", on: !black })}
        className={`mb-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
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
          className="rounded-2xl border border-zinc-700 py-8 text-3xl font-semibold text-zinc-100 transition-colors active:bg-zinc-900"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => send({ type: "go", dir: 1 })}
          aria-label="Suivant"
          className="rounded-2xl bg-zinc-100 py-8 text-3xl font-semibold text-zinc-900 transition-colors active:bg-white"
        >
          ▶
        </button>
      </div>
    </main>
  );
}
