"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { apiErrorMessage } from "@/lib/api-error";
import { navKeyBlocked } from "@/lib/use-list-keyboard-nav";

export type FolderChip = { id: string; name: string; count: number };

export function FolderBar({
  folders,
  rootCount,
  totalCount,
  active,
  showChips = true,
}: {
  folders: FolderChip[];
  rootCount: number;
  totalCount: number;
  active: string; // "home" | "all" | "none" | <folderId>
  /** L'accueil masque les pastilles (la grille de cartes les remplace) et ne
   *  garde que le bouton « + dossier ». */
  showChips?: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const activeFolder = folders.find((f) => f.id === active) ?? null;

  // Flèches ←/→ : change de dossier (Tous → dossiers → Non classés), dans le
  // même ordre que les chips. Empêche le défilement horizontal éventuel.
  const navRef = useRef<{ keys: string[]; hrefs: string[]; active: string }>({
    keys: [],
    hrefs: [],
    active,
  });
  useEffect(() => {
    navRef.current = {
      keys: ["all", ...folders.map((f) => f.id), "none"],
      hrefs: [
        "/admin?folder=all",
        ...folders.map((f) => `/admin?folder=${f.id}`),
        "/admin?folder=none",
      ],
      active,
    };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (navKeyBlocked()) return;
      const { keys, hrefs, active } = navRef.current;
      const cur = keys.indexOf(active);
      // Accueil (« home ») : pas de position dans l'anneau, flèches inertes.
      if (cur < 0) return;
      const next =
        e.key === "ArrowRight"
          ? Math.min(cur + 1, keys.length - 1)
          : Math.max(cur - 1, 0);
      e.preventDefault();
      if (next !== cur) router.push(hrefs[next]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (res.ok) {
        const f = await res.json();
        setName("");
        setCreating(false);
        router.push(`/admin?folder=${f.id}`);
        return;
      }
      notify(await apiErrorMessage(res, "Création du dossier impossible."));
    } catch {
      notify("Création du dossier impossible : erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!activeFolder) return;
    const n = window.prompt("Nouveau nom du dossier :", activeFolder.name);
    if (!n || !n.trim()) return;
    try {
      const res = await fetch(`/api/folders/${activeFolder.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n.trim() }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      notify(await apiErrorMessage(res, "Renommage impossible."));
    } catch {
      notify("Renommage impossible : erreur réseau.");
    }
  }

  async function remove() {
    if (!activeFolder) return;
    const ok = await confirm({
      title: `Supprimer le dossier « ${activeFolder.name} » ?`,
      message:
        "Les fichiers qu'il contient reviennent à la racine (ils ne sont pas supprimés).",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/folders/${activeFolder.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        // Même route (donc ni FileBrowser ni la régie ne sont démontés) et
        // c'est là que les fichiers du dossier supprimé viennent d'atterrir.
        router.push("/admin?folder=none");
        return;
      }
      notify(await apiErrorMessage(res, "Suppression du dossier impossible."));
    } catch {
      notify("Suppression du dossier impossible : erreur réseau.");
    }
  }

  function chip(href: string, label: string, isActive: boolean) {
    return (
      <Link
        key={href}
        href={href}
        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
          isActive
            ? "border-zinc-100 bg-zinc-100 text-zinc-900"
            : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
        }`}
      >
        {label}
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {active !== "home" && (
          <Link
            href="/admin"
            className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
          >
            ← Dossiers
          </Link>
        )}
        {showChips && (
          <>
            {chip("/admin?folder=all", `Tous (${totalCount})`, active === "all")}
            {folders.map((f) =>
              chip(
                `/admin?folder=${f.id}`,
                `${f.name} (${f.count})`,
                active === f.id,
              ),
            )}
            {chip(
              "/admin?folder=none",
              `Non classés (${rootCount})`,
              active === "none",
            )}
          </>
        )}

        {creating ? (
          <form onSubmit={createFolder} className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nom du dossier"
              className="w-36 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 disabled:opacity-60"
            >
              {busy ? "…" : "Créer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              className="px-1 text-xs text-zinc-500 hover:text-zinc-300"
            >
              annuler
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full border border-dashed border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
          >
            + dossier
          </button>
        )}
      </div>

      {activeFolder && (
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>
            Dossier : <span className="text-zinc-300">{activeFolder.name}</span>
          </span>
          <button type="button" onClick={rename} className="hover:text-zinc-200">
            Renommer
          </button>
          <button type="button" onClick={remove} className="hover:text-red-400">
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
