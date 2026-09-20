import Link from "next/link";
import { formatBytes, formatDay } from "@/lib/format";

/** Une carte de dossier sur l'écran d'accueil (tout est dérivé, rien en base). */
export type FolderCard = {
  id: string;
  name: string;
  count: number;
  size: number;
  /** Date du fichier le plus récent du dossier, ou null s'il est vide. */
  lastAdded: number | null;
  shareCount: number;
};

/** Résumé d'un lot : « 12 fichiers · 2,4 Go », ou « Vide ». */
function volume(count: number, size: number): string {
  if (count === 0) return "Vide";
  return `${count} fichier${count > 1 ? "s" : ""} · ${formatBytes(size)}`;
}

function lastAddedLabel(ms: number | null): string | undefined {
  return ms === null ? undefined : `Dernier ajout : ${formatDay(ms)}`;
}

function Card({
  href,
  title,
  summary,
  hint,
  shareCount = 0,
  accent = false,
}: {
  href: string;
  title: string;
  summary: string;
  hint?: string;
  shareCount?: number;
  accent?: boolean;
}) {
  // `min-w-0` sur la carte : sans lui, un élément de grille (min-width auto)
  // refuse de rétrécir sous la largeur de son titre — un nom de dossier long
  // déborde alors de l'écran au lieu d'être tronqué.
  return (
    <Link
      href={href}
      className={`flex min-w-0 flex-col gap-1 rounded-xl border px-4 py-4 transition-colors hover:bg-zinc-900 ${
        accent
          ? "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
          : "border-zinc-800 hover:border-zinc-600"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100">
          {title}
        </span>
        {shareCount > 0 && (
          <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
            {shareCount} partage{shareCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <span className="text-xs text-zinc-400">{summary}</span>
      {hint && <span className="text-xs text-zinc-600">{hint}</span>}
    </Link>
  );
}

/**
 * Écran d'accueil admin : on choisit un dossier avant de voir des fichiers.
 * Server Component pur (que des liens et du texte) — zéro JS client ajouté,
 * et aucune métadonnée de fichier ne traverse la frontière serveur/client.
 */
export function FolderGrid({
  folders,
  all,
  unsorted,
}: {
  folders: FolderCard[];
  all: { count: number; size: number };
  unsorted: { count: number; size: number; lastAdded: number | null };
}) {
  return (
    <section className="mt-6 flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          accent
          href="/admin?folder=all"
          title="Tous les fichiers"
          summary={volume(all.count, all.size)}
          hint="Pour chercher dans tout Filer"
        />
        {folders.map((f) => (
          <Card
            key={f.id}
            href={`/admin?folder=${f.id}`}
            title={f.name}
            summary={volume(f.count, f.size)}
            hint={lastAddedLabel(f.lastAdded)}
            shareCount={f.shareCount}
          />
        ))}
        <Card
          href="/admin?folder=none"
          title="Non classés"
          summary={volume(unsorted.count, unsorted.size)}
          hint={lastAddedLabel(unsorted.lastAdded)}
        />
      </div>

      {folders.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
          Aucun dossier pour l&apos;instant — crée le premier avec «&nbsp;+
          dossier&nbsp;» ci-dessus.
        </p>
      )}

      <Link
        href="/admin/remote"
        className="self-start rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
      >
        Télécommande de projection →
      </Link>
    </section>
  );
}
