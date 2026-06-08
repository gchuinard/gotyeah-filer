import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createFolder } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Crée un dossier (admin). Corps JSON : { name: string }. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

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

  const folder = createFolder(name);
  return Response.json(folder, { status: 201 });
}
