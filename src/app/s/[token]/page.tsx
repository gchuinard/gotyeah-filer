import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { getFile } from "@/lib/files";
import { formatBytes, formatDate } from "@/lib/format";
import { getShare } from "@/lib/shares";
import { ShareGate } from "@/app/s/[token]/share-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Filer · Partage" };

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        {children}
      </div>
    </main>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = getShare(token);

  if (!share) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">Lien invalide</h1>
        <p className="text-balance text-zinc-400">
          Ce lien de partage n&apos;existe pas ou a été révoqué.
        </p>
      </Centered>
    );
  }

  const file = getFile(share.file_id);
  if (!file) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">
          Fichier indisponible
        </h1>
        <p className="text-balance text-zinc-400">
          Le fichier de ce partage n&apos;est plus disponible.
        </p>
      </Centered>
    );
  }

  const session = await getSession();
  const authorized =
    session?.role === "admin" ||
    (session?.role === "guest" && session.share === token);

  if (!authorized) {
    // On ne révèle PAS le nom du fichier tant que l'email n'est pas autorisé.
    return (
      <Centered>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Filer</h1>
          <p className="text-balance text-zinc-400">
            Un fichier t&apos;a été partagé. Saisis ton adresse e-mail pour y
            accéder.
          </p>
        </div>
        <ShareGate token={token} />
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Fichier partagé
        </p>
        <h1 className="max-w-xs text-balance text-2xl font-semibold tracking-tight">
          {file.original_name}
        </h1>
        <p className="text-sm text-zinc-500">
          {formatBytes(file.size)} · {formatDate(file.created_at)}
        </p>
      </div>
      {file.mime?.startsWith("image/") && (
        // Aperçu servi inline (ne compte pas comme un téléchargement).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${file.id}?inline=1`}
          alt={file.original_name}
          className="max-h-80 w-full rounded-lg border border-zinc-800 object-contain"
        />
      )}
      <a
        href={`/api/files/${file.id}`}
        className="w-full rounded-lg bg-zinc-100 px-4 py-3 text-base font-medium text-zinc-900 transition-colors hover:bg-white"
      >
        Télécharger
      </a>
    </Centered>
  );
}
