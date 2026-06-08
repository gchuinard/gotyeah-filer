import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logout } from "@/app/actions";
import { listFiles } from "@/lib/files";
import { formatBytes, formatDate } from "@/lib/format";
import { UploadZone } from "@/app/admin/upload-zone";
import { DeleteButton } from "@/app/admin/delete-button";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  // Défense en profondeur : le proxy protège déjà /admin, on revérifie ici.
  if (session?.role !== "admin") {
    redirect("/");
  }

  const files = listFiles();

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
        <UploadZone />

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Fichiers ({files.length})
          </h2>

          {files.length === 0 ? (
            <p className="rounded-xl border border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
              Aucun fichier pour l&apos;instant. Dépose ton premier fichier
              ci-dessus.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">
                      {file.original_name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatBytes(file.size)} · {formatDate(file.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`/api/files/${file.id}`}
                      className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
                    >
                      Télécharger
                    </a>
                    <DeleteButton id={file.id} name={file.original_name} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
