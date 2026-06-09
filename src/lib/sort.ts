export type SortField = "name" | "date" | "size";
export type SortDir = "asc" | "desc";

type Sortable = { original_name: string; created_at: number; size: number };

/**
 * Trie une copie de la liste par nom (naturel, insensible à la casse), date ou
 * taille, dans le sens demandé. Ne modifie pas le tableau d'entrée.
 */
export function sortFiles<T extends Sortable>(
  files: T[],
  field: SortField,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    let c: number;
    if (field === "name") {
      c = a.original_name.localeCompare(b.original_name, "fr", {
        numeric: true,
        sensitivity: "base",
      });
    } else if (field === "date") {
      c = a.created_at - b.created_at;
    } else {
      c = a.size - b.size;
    }
    return c * sign;
  });
}
