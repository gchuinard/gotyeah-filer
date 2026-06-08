import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteFolder, renameFolder } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Renomme un dossier (admin). Corps JSON : { name: string }. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const name = String((body as { name?: unknown })?.name ?? "").trim();
  if (!name) {
    return Response.json({ error: "Nom de dossier requis." }, { status: 400 });
  }

  return renameFolder(id, name)
    ? new Response(null, { status: 204 })
    : new Response("Introuvable", { status: 404 });
}

/** Supprime un dossier (admin) ; ses fichiers repassent à la racine. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  return deleteFolder(id)
    ? new Response(null, { status: 204 })
    : new Response("Introuvable", { status: 404 });
}
