import { useRef, useState, type MouseEvent } from "react";

/**
 * Sélection multiple de fichiers avec prise en charge du **shift-clic** pour
 * cocher une plage entre le dernier élément cliqué et l'élément courant.
 *
 * `onClick` capture l'état de la touche Maj (il se déclenche juste avant
 * `onChange` sur une case à cocher), puis `onChange` applique : toggle simple,
 * ou ajout de toute la plage si Maj était enfoncée.
 */
export function useMultiSelect(files: { id: string }[]) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const shiftRef = useRef(false);
  const lastIndex = useRef<number | null>(null);

  function apply(index: number, id: string) {
    if (shiftRef.current && lastIndex.current !== null) {
      const a = Math.min(lastIndex.current, index);
      const b = Math.max(lastIndex.current, index);
      const range = files.slice(a, b + 1).map((f) => f.id);
      setChecked((prev) => {
        const next = new Set(prev);
        range.forEach((rid) => next.add(rid));
        return next;
      });
    } else {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastIndex.current = index;
  }

  const allChecked = files.length > 0 && checked.size === files.length;

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(files.map((f) => f.id)));
    lastIndex.current = null;
  }

  function clear() {
    setChecked(new Set());
    lastIndex.current = null;
  }

  /** Props à étaler sur la case à cocher d'une ligne (index = position dans la liste). */
  function checkboxProps(index: number, id: string) {
    return {
      checked: checked.has(id),
      onClick: (e: MouseEvent) => {
        shiftRef.current = e.shiftKey;
      },
      onChange: () => apply(index, id),
    };
  }

  return { checked, allChecked, toggleAll, clear, checkboxProps };
}
