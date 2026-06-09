"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";

export type Share = {
  token: string;
  emails: string[];
  created_at: number;
};

/** Validation de format légère (le vrai contrôle reste la « porte » à l'accès). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ShareManager({
  endpoint,
  appUrl,
  initialShares,
  bare = false,
}: {
  /** Route de création du partage (fichier ou dossier). */
  endpoint: string;
  appUrl: string;
  initialShares: Share[];
  /** Sans le repli « Partages / Gérer » : affiche directement le contenu
   *  (utilisé dans la modale de partage). */
  bare?: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>(initialShares);
  // Emails autorisés en cours de saisie (1 chip = 1 email, pas d'édition).
  const [pending, setPending] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const base =
    appUrl || (typeof window !== "undefined" ? window.location.origin : "");

  function addEmail(e: React.FormEvent) {
    e.preventDefault();
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      setError("Adresse e-mail invalide.");
      return;
    }
    if (pending.includes(v)) {
      setError("Cette adresse est déjà ajoutée.");
      setDraft("");
      return;
    }
    setError(null);
    setPending((p) => [...p, v]);
    setDraft("");
  }

  function removeEmail(email: string) {
    setPending((p) => p.filter((x) => x !== email));
  }

  async function create() {
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails: pending }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Échec de la création.");
      } else {
        const s = await res.json();
        setShares((prev) => [
          { token: s.token, emails: s.emails, created_at: s.created_at },
          ...prev,
        ]);
        setPending([]);
        router.refresh();
      }
    } catch {
      setError("Erreur réseau.");
    }
    setBusy(false);
  }

  async function revoke(token: string) {
    const ok = await confirm({
      title: "Révoquer ce partage ?",
      message: "Le lien cessera immédiatement de fonctionner.",
      confirmLabel: "Révoquer",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/shares/${token}`, { method: "DELETE" });
    if (res.ok) {
      setShares((prev) => prev.filter((s) => s.token !== token));
      router.refresh();
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`${base}/s/${token}`);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      setError("Copie impossible (autorise le presse-papier).");
    }
  }

  const content = (
    <div className="flex flex-col gap-3">
      {shares.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shares.map((s) => (
            <li
              key={s.token}
              className="flex flex-col gap-1 rounded-md border border-zinc-800 px-2 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <code className="truncate text-zinc-300">/s/{s.token}</code>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => copy(s.token)}
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    {copied === s.token ? "Copié ✓" : "Copier le lien"}
                  </button>
                  <button
                    type="button"
                    onClick={() => revoke(s.token)}
                    className="rounded border border-zinc-800 px-2 py-1 text-zinc-400 transition-colors hover:border-red-900 hover:text-red-400"
                  >
                    Révoquer
                  </button>
                </div>
              </div>
              {s.emails.length > 0 && (
                <span className="truncate text-zinc-500">
                  {s.emails.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {pending.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {pending.map((email) => (
              <li
                key={email}
                className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs"
              >
                <span className="truncate text-zinc-200">{email}</span>
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  aria-label={`Retirer ${email}`}
                  className="shrink-0 text-zinc-500 transition-colors hover:text-red-400"
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addEmail} className="flex gap-2">
          <input
            type="email"
            autoFocus={bare}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="email@exemple.com"
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Ajouter
          </button>
        </form>

        {error && <span className="text-xs text-red-400">{error}</span>}

        <button
          type="button"
          onClick={create}
          disabled={busy || pending.length === 0}
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
        >
          {busy
            ? "…"
            : `Créer le partage${pending.length > 1 ? ` (${pending.length})` : ""}`}
        </button>
      </div>
    </div>
  );

  if (bare) return content;

  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <span>Partages ({shares.length})</span>
        <span>{open ? "Masquer" : "Gérer"}</span>
      </button>

      {open && <div className="px-3 pb-3">{content}</div>}
    </div>
  );
}
