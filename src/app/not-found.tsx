import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">404</h1>
        <p className="text-balance text-zinc-400">Cette page n&apos;existe pas.</p>
        <Link
          href="/"
          className="mt-2 text-sm text-zinc-300 underline-offset-4 hover:underline"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
