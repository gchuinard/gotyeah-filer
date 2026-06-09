"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteButton({
  id,
  name,
  className,
  label = "Supprimer",
  onDeleted,
}: {
  id: string;
  name: string;
  /** Style optionnel (sinon bouton bordé par défaut). */
  className?: string;
  label?: string;
  /** Appelé après suppression réussie (avant le refresh). */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (
      !window.confirm(`Supprimer « ${name} » ? Cette action est définitive.`)
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) {
        window.alert("Échec de la suppression.");
        setBusy(false);
        return;
      }
      onDeleted?.();
      router.refresh();
    } catch {
      window.alert("Erreur réseau.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className={
        className ??
        "rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:border-red-900 hover:text-red-400 disabled:opacity-50"
      }
    >
      {busy ? "…" : label}
    </button>
  );
}
