"use client";

import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";

export type Share = {
  token: string;
  emails: string[];
  created_at: number;
};

export function ShareManager({
  endpoint,
  appUrl,
  initialShares,
  defaultOpen = false,
}: {
  /** Route de création du partage (fichier ou dossier). */
  endpoint: string;
  appUrl: string;
  initialShares: Share[];
  /** Ouvre le panneau d'emblée (ex. déclenché depuis l'aside). */
  defaultOpen?: boolean;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(defaultOpen);
  const [shares, setShares] = useState<Share[]>(initialShares);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const base =
    appUrl || (typeof window !== "undefined" ? window.location.origin : "");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const list = emails
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      setError("Saisis au moins une adresse e-mail.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails: list }),
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
        setEmails("");
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
    if (res.ok) setShares((prev) => prev.filter((s) => s.token !== token));
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

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
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

          <form onSubmit={create} className="flex flex-col gap-2">
            <input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="emails autorisés, séparés par des virgules"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-60"
              >
                {busy ? "…" : "Créer un partage"}
              </button>
              {error && <span className="text-xs text-red-400">{error}</span>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
