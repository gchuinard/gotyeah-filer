import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getFile, type FileRow } from "@/lib/files";
import { zipFilesResponse } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Télécharge une SÉLECTION de fichiers (par ids) sous forme d'archive .zip
 * (admin uniquement). Conçu pour un POST de formulaire (le navigateur stream la
 * réponse vers le disque) : pas de limite de longueur d'URL, pas de mise en
 * mémoire côté client. Accepte aussi un corps JSON { ids: string[] }.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  let ids: string[] = [];
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
    } | null;
    const raw = body?.ids;
    ids = Array.isArray(raw)
      ? raw.map(String)
      : typeof raw === "string"
        ? raw.split(",")
        : [];
  } else {
    const form = await request.formData().catch(() => null);
    const raw = form?.get("ids");
    ids = typeof raw === "string" ? raw.split(",") : [];
  }

  // Normalise + déduplique (en gardant l'ordre).
  const seen = new Set<string>();
  const files: FileRow[] = [];
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const file = getFile(id);
    if (file) files.push(file);
  }

  if (files.length === 0) {
    return new Response("Aucun fichier sélectionné.", { status: 400 });
  }

  const resp = await zipFilesResponse(files, "selection.zip");
  return resp ?? new Response("Aucun fichier disponible", { status: 404 });
}
