import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getFile, listFilesInFolder } from "@/lib/files";
import { getFolder } from "@/lib/folders";
import { formatBytes, formatDate } from "@/lib/format";
import { getShare, isShareExpired } from "@/lib/shares";
import { ShareGate } from "@/app/s/[token]/share-gate";
import { FolderGallery } from "@/app/s/[token]/folder-gallery";

export const dynamic = "force-dynamic";
// Pages de partage jamais indexées (un lien public reste un secret à transmettre).
export const metadata: Metadata = {
  title: "Filer · Partage",
  robots: { index: false, follow: false },
};

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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string | string[] }>;
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

  // Avant tout contrôle de session : un lien expiré ne montre plus rien, même à
  // qui y était déjà entré (les routes de fichiers le refusent aussi).
  if (isShareExpired(share)) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">Lien expiré</h1>
        <p className="text-balance text-zinc-400">
          Ce lien de partage n&apos;est plus valable. Demande un nouveau lien à
          la personne qui te l&apos;a envoyé.
        </p>
      </Centered>
    );
  }

  const isFolder = share.folder_id != null;
  const session = await getSession();
  const authorized =
    session?.role === "admin" ||
    (session?.role === "guest" && (session.shares ?? []).includes(token));
  const { e } = await searchParams;
  const here = `/s/${encodeURIComponent(token)}`;

  // Entrée réussie : on retire `?e=1` de l'adresse, sinon un lien recopié depuis
  // la barre d'adresse et transféré ouvrirait « Cookies bloqués » chez le
  // destinataire.
  if (authorized && e !== undefined) redirect(here);

  // Lien public : on entre directement, sans e-mail (la Route Handler pose la
  // session invité). `?e=1` = entrée déjà tentée : si on n'est toujours pas
  // autorisé, le navigateur refuse les cookies → message plutôt qu'une boucle.
  if (!authorized && share.public === 1) {
    if (e !== "1") redirect(`${here}/entrer`);
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cookies bloqués
        </h1>
        <p className="text-balance text-zinc-400">
          Pour ouvrir ce lien, ton navigateur doit accepter les cookies de ce
          site (navigation privée stricte ou bloqueur ?).
        </p>
        <a
          href={`${here}/entrer`}
          className="w-full rounded-lg bg-zinc-100 px-4 py-3 text-base font-medium text-zinc-900 transition-colors hover:bg-white"
        >
          Réessayer
        </a>
      </Centered>
    );
  }

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

    const files = listFilesInFolder(folder.id).map((f) => ({
      id: f.id,
      original_name: f.original_name,
      mime: f.mime,
      size: f.size,
      created_at: f.created_at,
    }));

    return (
      <FolderGallery
        files={files}
        folderName={folder.name}
        folderId={folder.id}
      />
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
