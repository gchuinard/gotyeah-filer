"use client";

import { useRef } from "react";
import { logout } from "@/app/actions";
import { useConfirm } from "@/components/confirm-dialog";
import {
  cancelAllUploads,
  hasActiveUploads,
  hasOpenUploadSessions,
} from "@/lib/upload-queue";

/**
 * Déconnexion, avec garde-fou pendant un envoi : la déconnexion est une
 * navigation interne (Server Action + redirect), `beforeunload` ne se
 * déclenche donc pas — sans ce garde-fou, l'envoi échouerait en silence (403)
 * en laissant son partiel sur le disque jusqu'à la purge.
 */
export function LogoutButton() {
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  return (
    <form
      ref={formRef}
      action={logout}
      onSubmit={async (e) => {
        if (confirmed.current) return;
        const active = hasActiveUploads();
        // Envois en erreur : rien à confirmer, mais leurs sessions doivent être
        // fermées AVANT la déconnexion (après, le DELETE prendrait un 403).
        if (!active && !hasOpenUploadSessions()) return;
        e.preventDefault();
        if (active) {
          const ok = await confirm({
            title: "Un envoi est en cours",
            message:
              "Te déconnecter maintenant annule les envois en cours : les données déjà envoyées seront perdues.",
            confirmLabel: "Annuler les envois et me déconnecter",
            cancelLabel: "Rester connecté",
            danger: true,
          });
          if (!ok) return;
        }
        await cancelAllUploads();
        confirmed.current = true;
        formRef.current?.requestSubmit();
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
      >
        Se déconnecter
      </button>
    </form>
  );
}
