import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logout } from "@/app/actions";

export default async function AdminPage() {
  const session = await getSession();
  // Défense en profondeur : le proxy protège déjà /admin, on revérifie ici.
  if (session?.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
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
      <main className="flex flex-1 items-center justify-center px-6 py-16 text-center">
        <p className="max-w-sm text-zinc-400">
          Espace admin connecté. La gestion des fichiers (upload, liste,
          suppression, partages) arrive en Phase 3.
        </p>
      </main>
    </div>
  );
}
