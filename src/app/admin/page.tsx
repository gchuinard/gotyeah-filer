import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logout } from "@/app/actions";
import { getAppUrl } from "@/lib/config";
import { listFiles } from "@/lib/files";
import { listFolders } from "@/lib/folders";
import { listShares, parseAllowedEmails } from "@/lib/shares";
import { formatBytes, formatDate } from "@/lib/format";
import { UploadZone } from "@/app/admin/upload-zone";
import { DeleteButton } from "@/app/admin/delete-button";
import { MoveSelect } from "@/app/admin/move-select";
import { FolderBar } from "@/app/admin/folder-bar";
import { ShareManager, type Share } from "@/app/admin/share-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Filer · Admin" };

/** Extension en majuscules pour la pastille des fichiers non-image. */
function extLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return ext.slice(0, 4).toUpperCase() || "FIC";
}

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

  // Partages regroupés par fichier (une seule requête).
  const sharesByFile = new Map<string, Share[]>();
  for (const s of listShares()) {
    const list = sharesByFile.get(s.file_id) ?? [];
    list.push({
      token: s.token,
      emails: parseAllowedEmails(s),
      created_at: s.created_at,
    });
    sharesByFile.set(s.file_id, list);
  }

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

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <FolderBar
          folders={folderChips}
          rootCount={rootCount}
          totalCount={allFiles.length}
          active={active}
        />

        <div className="mt-6">
          <UploadZone folderId={activeFolderId} />
        </div>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Fichiers ({files.length})
          </h2>

          {files.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
              {allFiles.length === 0
                ? "Aucun fichier pour l'instant. Dépose ton premier fichier ci-dessus."
                : "Aucun fichier dans cette vue."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
              {files.map((file) => (
                <li key={file.id} className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      {file.mime?.startsWith("image/") ? (
                        // Aperçu servi inline (ne compte pas comme un téléchargement).
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/files/${file.id}?inline=1`}
                          alt=""
                          loading="lazy"
                          className="size-11 shrink-0 rounded-md border border-zinc-800 object-cover"
                        />
                      ) : (
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-[10px] font-medium text-zinc-500">
                          {extLabel(file.original_name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-100">
                          {file.original_name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {formatBytes(file.size)} ·{" "}
                          {formatDate(file.created_at)} · ↓{" "}
                          {file.download_count}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <MoveSelect
                        fileId={file.id}
                        folders={folderOptions}
                        current={file.folder_id}
                      />
                      <a
                        href={`/api/files/${file.id}`}
                        className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
                      >
                        Télécharger
                      </a>
                      <DeleteButton id={file.id} name={file.original_name} />
                    </div>
                  </div>
                  <ShareManager
                    fileId={file.id}
                    appUrl={appUrl}
                    initialShares={sharesByFile.get(file.id) ?? []}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
