"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  cancelUpload,
  getUploadsServerSnapshot,
  getUploadsSnapshot,
  isActiveState,
  onUploadCompleted,
  retryUpload,
  subscribeUploads,
} from "@/lib/upload-queue";

/**
 * Bandeau d'envoi dans le header admin, monté sur l'accueil COMME dans
 * l'explorateur : un envoi continue quand on change de vue, il doit rester
 * visible — ses échecs aussi (sur l'accueil, la liste détaillée n'est pas là).
 * Porte l'avertissement explicite (le popup natif du navigateur avant
 * fermeture n'accepte pas de texte personnalisé), et rafraîchit la liste des
 * fichiers quand la file se vide.
 */
export function UploadStatus() {
  const router = useRouter();
  const uploads = useSyncExternalStore(
    subscribeUploads,
    getUploadsSnapshot,
    getUploadsServerSnapshot,
  );
  const completedSinceRefresh = useRef(false);

  useEffect(
    () =>
      onUploadCompleted(() => {
        completedSinceRefresh.current = true;
      }),
    [],
  );

  const active = uploads.filter((u) => isActiveState(u.state));
  const failed = uploads.filter((u) => u.state === "error");
  const activeCount = active.length;

  // Rafraîchit les données serveur une fois la file VIDE seulement : après un
  // déploiement, `router.refresh()` peut devenir une navigation complète
  // (build-id changé) — en plein envoi, elle déclencherait le popup « quitter
  // la page ? » et figerait les envois restants jusqu'à ce qu'on y réponde.
  useEffect(() => {
    if (activeCount > 0 || !completedSinceRefresh.current) return;
    const timer = setTimeout(() => {
      completedSinceRefresh.current = false;
      router.refresh();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeCount, router]);

  if (activeCount === 0 && failed.length === 0) return null;

  // Sur téléphone, le bandeau prend sa propre ligne sous le header.
  const box =
    "order-last w-full rounded-lg border px-3 py-1.5 text-xs sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:text-sm";

  if (activeCount === 0) {
    return (
      <div
        role="alert"
        className={`${box} flex flex-wrap items-center gap-x-3 gap-y-1 border-red-800/60 bg-red-950/40 text-red-200`}
      >
        <span className="min-w-0 flex-1">
          <span className="font-medium">
            ⚠{" "}
            {failed.length > 1
              ? `${failed.length} envois ont échoué`
              : `L'envoi de « ${failed[0].name} » a échoué`}
          </span>
          {failed[0].message && (
            <span className="text-red-300/80"> — {failed[0].message}</span>
          )}
        </span>
        <span className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => failed.forEach((u) => retryUpload(u.key))}
            className="font-medium text-red-100 hover:text-white"
          >
            Réessayer
          </button>
          <button
            type="button"
            onClick={() => failed.forEach((u) => cancelUpload(u.key))}
            className="text-red-300/80 hover:text-red-100"
          >
            Retirer
          </button>
        </span>
      </div>
    );
  }

  const size = active.reduce((n, u) => n + u.size, 0);
  const sent = active.reduce((n, u) => n + u.sent, 0);
  const percent = size > 0 ? Math.floor((sent / size) * 100) : 0;
  const retrying = active.some((u) => u.state === "retrying");

  return (
    <div
      role="status"
      className={`${box} ${
        retrying
          ? "border-amber-700/60 bg-amber-950/40 text-amber-200"
          : "border-sky-800/60 bg-sky-950/40 text-sky-200"
      }`}
    >
      <span className="font-medium">
        ↑ {activeCount > 1 ? `${activeCount} envois` : "Envoi"} en cours ·{" "}
        {percent} %{retrying ? " · reconnexion…" : ""}
        {failed.length > 0 ? ` · ${failed.length} en échec` : ""}
      </span>
      <span className="text-zinc-400">
        {" "}
        — ne ferme pas et ne recharge pas cet onglet, l&apos;envoi serait coupé.
        <span className="hidden sm:inline">
          {" "}
          Garde l&apos;ordinateur allumé et branché.
        </span>
      </span>
    </div>
  );
}
