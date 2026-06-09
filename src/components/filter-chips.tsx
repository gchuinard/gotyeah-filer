"use client";

import type { MediaFilter } from "@/lib/media";

const CHIPS: { key: MediaFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "image", label: "Images" },
  { key: "audio", label: "Audio" },
  { key: "video", label: "Vidéo" },
  { key: "other", label: "Fichiers" },
];

/**
 * Barre de filtres par type (chips). Affiche « Tous » plus chaque catégorie
 * non vide, avec son compte. Mutualisé entre l'admin et la page invité.
 */
export function FilterChips({
  counts,
  active,
  onSelect,
}: {
  counts: Record<MediaFilter, number>;
  active: MediaFilter;
  onSelect: (f: MediaFilter) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {CHIPS.filter((c) => c.key === "all" || counts[c.key] > 0).map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(c.key)}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            active === c.key
              ? "border-zinc-100 bg-zinc-100 text-zinc-900"
              : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
          }`}
        >
          {c.label} ({counts[c.key]})
        </button>
      ))}
    </div>
  );
}
