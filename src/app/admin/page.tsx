import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logout } from "@/app/actions";
import { getAppUrl } from "@/lib/config";
import { listFiles } from "@/lib/files";
import { listFolders } from "@/lib/folders";
import { listShares, parseAllowedEmails } from "@/lib/shares";
import { UploadZone } from "@/app/admin/upload-zone";
import { FolderBar } from "@/app/admin/folder-bar";
import { ShareManager, type Share } from "@/app/admin/share-manager";
import { FileBrowser } from "@/app/admin/file-browser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Filer · Admin" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string | string[] }>;
}) {
  const session = await getSession();
  // Défense en profondeur : le proxy protège déjà /admin, on revérifie ici.
  if (session?.role !== "admin") {
    redirect("/");
  }

  const allFiles = listFiles();
  const folders = listFolders();
  const appUrl = getAppUrl();

  // Dossier actif depuis l'URL (?folder=…), normalisé.
  const sp = await searchParams;
  const raw = typeof sp.folder === "string" ? sp.folder : undefined;
  const isFolder = folders.some((f) => f.id === raw);
  const active = raw === "none" || isFolder ? (raw as string) : "all";
  const activeFolderId = isFolder ? (raw as string) : null;

  // Comptes par dossier pour la barre.
  const countByFolder = new Map<string, number>();
  let rootCount = 0;
  for (const f of allFiles) {
    if (f.folder_id) {
      countByFolder.set(f.folder_id, (countByFolder.get(f.folder_id) ?? 0) + 1);
    } else {
      rootCount += 1;
    }
  }
  const folderChips = folders.map((f) => ({
    id: f.id,
    name: f.name,
    count: countByFolder.get(f.id) ?? 0,
  }));
  const folderOptions = folders.map((f) => ({ id: f.id, name: f.name }));

  // Fichiers filtrés selon le dossier actif.
  const files = allFiles.filter((f) => {
    if (active === "all") return true;
    if (active === "none") return f.folder_id == null;
    return f.folder_id === active;
  });

  // Partages regroupés par cible (une seule requête) : fichiers d'un côté,
  // dossiers de l'autre (un partage vise l'un OU l'autre).
  const sharesByFile = new Map<string, Share[]>();
  const sharesByFolder = new Map<string, Share[]>();
  for (const s of listShares()) {
    const entry: Share = {
      token: s.token,
      emails: parseAllowedEmails(s),
      created_at: s.created_at,
    };
    if (s.file_id) {
      sharesByFile.set(s.file_id, [...(sharesByFile.get(s.file_id) ?? []), entry]);
    } else if (s.folder_id) {
      sharesByFolder.set(s.folder_id, [
        ...(sharesByFolder.get(s.folder_id) ?? []),
        entry,
      ]);
    }
  }
  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  // Map -> objet sérialisable pour le composant client.
  const sharesByFileObj = Object.fromEntries(sharesByFile);
  // On n'envoie au client que les champs utiles (pas stored_name).
  const fileItems = files.map((f) => ({
    id: f.id,
    original_name: f.original_name,
    mime: f.mime,
    size: f.size,
    created_at: f.created_at,
    folder_id: f.folder_id,
    download_count: f.download_count,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-4 sm:px-6">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Filer · Admin</span>
          <span className="text-xs text-zinc-500">{session.email}</span>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            Se déconnecter
          </button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-[1700px] flex-1 px-3 py-6 sm:px-4">
        <FolderBar
          folders={folderChips}
          rootCount={rootCount}
          totalCount={allFiles.length}
          active={active}
        />

        {activeFolder && (
          <div className="mt-4 rounded-xl border border-zinc-800 px-4 py-3">
            <p className="mb-2 text-xs text-zinc-400">
              Partager le dossier{" "}
              <span className="text-zinc-200">« {activeFolder.name} »</span> —
              tous ses fichiers, lien unique.
            </p>
            <ShareManager
              endpoint={`/api/folders/${activeFolder.id}/shares`}
              appUrl={appUrl}
              initialShares={sharesByFolder.get(activeFolder.id) ?? []}
            />
          </div>
        )}

        <div className="mt-6">
          <UploadZone folderId={activeFolderId} />
        </div>

        <section className="mt-10">
          <FileBrowser
            files={fileItems}
            folders={folderOptions}
            appUrl={appUrl}
            shares={sharesByFileObj}
            noFilesAtAll={allFiles.length === 0}
          />
        </section>
      </main>
    </div>
  );
}
