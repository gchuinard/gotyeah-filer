import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { getFile, listFilesInFolder, type FileRow } from "@/lib/files";
import { getFolder } from "@/lib/folders";
import { extLabel, formatBytes, formatDate } from "@/lib/format";
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

/** Vignette : image servie inline (ne compte pas), sinon pastille d'extension. */
function Thumb({ file }: { file: FileRow }) {
  if (file.mime?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${file.id}?inline=1`}
        alt=""
        loading="lazy"
        className="size-11 shrink-0 rounded-md border border-zinc-800 object-cover"
      />
    );
  }
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-[10px] font-medium text-zinc-500">
      {extLabel(file.original_name)}
    </div>
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

  const isFolder = share.folder_id != null;
  const session = await getSession();
  const authorized =
    session?.role === "admin" ||
    (session?.role === "guest" && session.share === token);

  if (!authorized) {
    // On ne révèle PAS le contenu tant que l'email n'est pas autorisé.
    return (
      <Centered>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Filer</h1>
          <p className="text-balance text-zinc-400">
            {isFolder
              ? "Un dossier t'a été partagé. Saisis ton adresse e-mail pour y accéder."
              : "Un fichier t'a été partagé. Saisis ton adresse e-mail pour y accéder."}
          </p>
        </div>
        <ShareGate
          token={token}
          cta={isFolder ? "Accéder aux fichiers" : "Accéder au fichier"}
        />
      </Centered>
    );
  }

  // ---- Partage de dossier : liste des fichiers + « Tout télécharger (.zip) » ----
  if (isFolder) {
    const folder = getFolder(share.folder_id as string);
    if (!folder) {
      return (
        <Centered>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dossier indisponible
          </h1>
          <p className="text-balance text-zinc-400">
            Le dossier de ce partage n&apos;est plus disponible.
          </p>
        </Centered>
      );
    }

    const files = listFilesInFolder(folder.id);

    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 py-12">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Dossier partagé
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {folder.name}
            </h1>
            {files.length > 0 && (
              <a
                href={`/api/folders/${folder.id}/download`}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
              >
                Tout télécharger (.zip)
              </a>
            )}
          </div>
          <p className="text-sm text-zinc-500">
            {files.length} fichier{files.length > 1 ? "s" : ""}
          </p>
        </div>

        {files.length === 0 ? (
          <p className="mt-8 rounded-xl border border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
            Aucun fichier dans ce dossier pour l&apos;instant.
          </p>
        ) : (
          <ul className="mt-6 flex flex-col divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb file={file} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">
                      {file.original_name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatBytes(file.size)} · {formatDate(file.created_at)}
                    </p>
                  </div>
                </div>
                <a
                  href={`/api/files/${file.id}`}
                  className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
                >
                  Télécharger
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  // ---- Partage d'un fichier unique ----
  const file = getFile(share.file_id as string);
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
