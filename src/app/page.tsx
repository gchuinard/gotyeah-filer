export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Filer</h1>
        <p className="max-w-sm text-balance text-zinc-400">
          Partage de fichiers — espace familial.
        </p>
        <p className="mt-6 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-sm text-zinc-500">
          Scaffold en place — la porte d&apos;accès arrive (Phase 2).
        </p>
      </div>
    </main>
  );
}
