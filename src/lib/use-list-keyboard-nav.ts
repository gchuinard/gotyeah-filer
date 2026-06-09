import { useEffect, useRef } from "react";

/**
 * Navigation clavier ↑/↓ dans une liste de fichiers : sélectionne le précédent /
 * suivant et empêche le défilement de la page. Ignoré quand on saisit (input,
 * textarea, select), qu'un lecteur média est focalisé (le ↑/↓ règle le volume)
 * ou qu'une modale est ouverte.
 */
export function useListKeyboardNav(
  items: { id: string }[],
  currentId: string | null,
  onSelect: (id: string) => void,
) {
  const itemsRef = useRef(items);
  const currentRef = useRef(currentId);
  const onSelectRef = useRef(onSelect);

  // Garde les refs à jour (hors rendu) pour que le handler lise les valeurs
  // courantes sans se ré-enregistrer.
  useEffect(() => {
    itemsRef.current = items;
    currentRef.current = currentId;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Modale ouverte (partage, confirmation…) : on laisse la main.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "VIDEO" ||
        tag === "AUDIO" ||
        el?.isContentEditable
      ) {
        return;
      }

      const list = itemsRef.current;
      if (list.length === 0) return;
      const i = list.findIndex((x) => x.id === currentRef.current);
      const next =
        e.key === "ArrowDown"
          ? i < 0
            ? 0
            : Math.min(i + 1, list.length - 1)
          : i < 0
            ? 0
            : Math.max(i - 1, 0);

      e.preventDefault();
      const id = list[next].id;
      onSelectRef.current(id);
      // Garde la ligne sélectionnée visible dans l'aside.
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-navitem="${id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
