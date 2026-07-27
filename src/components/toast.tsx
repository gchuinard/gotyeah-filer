"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastKind = "error" | "success";

type ToastItem = { id: number; kind: ToastKind; message: string };

/** `notify("message")` → erreur ; `notify("message", "success")` → succès. */
type NotifyFn = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<NotifyFn | null>(null);

/** Hook : `const notify = useToast(); notify("Déplacement refusé.")`. */
export function useToast(): NotifyFn {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast doit être utilisé dans <ToastProvider>.");
  }
  return ctx;
}

/**
 * Notifications éphémères, en pendant de `useConfirm()`. Raison d'être : une
 * requête refusée (403, 400, 500) ne doit JAMAIS disparaître sans un mot —
 * l'ancien motif `if (res.ok) router.refresh()` sans `else` rendait les échecs
 * totalement invisibles côté utilisateur.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Compteur d'ids : incrémenté dans un gestionnaire d'événement, jamais
  // pendant le rendu (react-hooks/refs).
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<NotifyFn>((message, kind = "error") => {
    const id = nextId.current;
    nextId.current += 1;
    // On borne la pile : au-delà de 4, on oublie les plus anciens.
    setToasts((prev) => [...prev, { id, kind, message }].slice(-4));
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toasts.length > 0 && (
        <div
          // z-[100] : au-dessus de la modale de confirmation (z-[90]) et de la
          // régie de projection (z-[70]/z-[80]).
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
          aria-live="assertive"
        >
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { id, kind, message } = toast;

  // Auto-disparition : on laisse plus longtemps une erreur qu'un succès.
  useEffect(() => {
    const delay = kind === "error" ? 8000 : 4000;
    const timer = setTimeout(() => onDismiss(id), delay);
    return () => clearTimeout(timer);
  }, [id, kind, onDismiss]);

  return (
    <button
      type="button"
      onClick={() => onDismiss(id)}
      role={kind === "error" ? "alert" : "status"}
      aria-label="Fermer la notification"
      className={`pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 text-left text-sm shadow-2xl backdrop-blur transition-colors ${
        kind === "error"
          ? "border-red-900 bg-red-950/90 text-red-100 hover:border-red-700"
          : "border-zinc-700 bg-zinc-900/90 text-zinc-100 hover:border-zinc-500"
      }`}
    >
      {message}
    </button>
  );
}
