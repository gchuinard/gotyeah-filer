"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";
import { apiErrorMessage } from "@/lib/api-error";
import { formatDate } from "@/lib/format";
import type { ShareDto } from "@/lib/shares";

export type Share = ShareDto;

/** Durées proposées pour un lien public ("never" = sans expiration). */
const PUBLIC_DURATIONS = [
  { value: "1", label: "1 jour" },
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "never", label: "Sans expiration" },
] as const;

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
  const [duration, setDuration] = useState<string>("7");

  const base =
    appUrl || (typeof window !== "undefined" ? window.location.origin : "");

  /** Lien public : créé puis copié d'un clic, prêt à coller dans un message. */
  async function createPublic() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          public: true,
          days: duration === "never" ? null : Number(duration),
        }),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, "Échec de la création du lien."));
      } else {
        const s = (await res.json()) as Share;
        setShares((prev) => [s, ...prev]);
        await copy(s.token);
        router.refresh();
      }
    } catch {
      setError("Erreur réseau.");
    }
    setBusy(false);
  }

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
        // `apiErrorMessage` gère aussi les réponses en texte brut (« Accès
        // refusé ») : un `res.json()` seul les perdait au profit d'un message
        // générique qui masquait la vraie cause.
        setError(await apiErrorMessage(res, "Échec de la création."));
      } else {
        const s = (await res.json()) as Share;
        setShares((prev) => [s, ...prev]);
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
    try {
      const res = await fetch(`/api/shares/${token}`, { method: "DELETE" });
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.token !== token));
        router.refresh();
        return;
      }
      setError(await apiErrorMessage(res, "Révocation impossible."));
    } catch {
      setError("Révocation impossible : erreur réseau.");
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
              {s.public ? (
                <span
                  className={`truncate ${s.expired ? "text-red-400" : "text-sky-300"}`}
                >
                  Lien public ·{" "}
                  {s.expired
                    ? "expiré"
                    : s.expires_at
                      ? `expire le ${formatDate(s.expires_at)}`
                      : "sans expiration"}
                </span>
              ) : (
                s.emails.length > 0 && (
                  <span className="truncate text-zinc-500">
                    {s.emails.join(", ")}
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <span className="text-xs text-zinc-300">
          <span className="font-medium">Lien public</span> — sans e-mail :
          quiconque a le lien y accède.
        </span>
        <div className="flex gap-2">
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            aria-label="Durée de validité du lien"
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-500"
          >
            {PUBLIC_DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={createPublic}
            disabled={busy}
            className="shrink-0 rounded-md bg-sky-200 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-sky-100 disabled:opacity-50"
          >
            {busy ? "…" : "Créer et copier le lien"}
          </button>
        </div>
      </div>

      <span className="text-[11px] uppercase tracking-wide text-zinc-500">
        ou réservé à des adresses e-mail
      </span>

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
