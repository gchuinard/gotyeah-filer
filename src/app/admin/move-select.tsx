"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { apiErrorMessage } from "@/lib/api-error";

type Option = { id: string; name: string };

export function MoveSelect({
  fileId,
  folders,
  current,
}: {
  fileId: string;
  folders: Option[];
  current: string | null;
}) {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const select = e.target;
    const value = select.value; // "" = racine
    const previous = current ?? "";
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${fileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: value || null }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      // Échec : on le dit ET on remet le select sur l'ancien dossier, sinon il
      // affiche une destination où le fichier n'est pas.
      select.value = previous;
      notify(await apiErrorMessage(res, "Déplacement impossible."));
    } catch {
      select.value = previous;
      notify("Déplacement impossible : erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Déplacer dans un dossier"
      disabled={busy || folders.length === 0}
      defaultValue={current ?? ""}
      onChange={onChange}
      className="max-w-[12rem] rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-500 disabled:opacity-50"
    >
      <option value="">Aucun dossier</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
