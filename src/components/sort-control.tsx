"use client";

import type { SortField, SortDir } from "@/lib/sort";

const FIELDS: { key: SortField; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "name", label: "Nom" },
  { key: "size", label: "Taille" },
];

/** Contrôle de tri (champ + sens), mutualisé entre l'admin et la page invité. */
export function SortControl({
  field,
  dir,
  onField,
  onToggleDir,
}: {
  field: SortField;
  dir: SortDir;
  onField: (f: SortField) => void;
  onToggleDir: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
      <span>Trier</span>
      <select
        aria-label="Trier par"
        value={field}
        onChange={(e) => onField(e.target.value as SortField)}
        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-300 outline-none focus:border-zinc-500"
      >
        {FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onToggleDir}
        aria-label="Inverser le sens du tri"
        title={dir === "asc" ? "Croissant" : "Décroissant"}
        className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-300 transition-colors hover:bg-zinc-900"
      >
        {dir === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}
