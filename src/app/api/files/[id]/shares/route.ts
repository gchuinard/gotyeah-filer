import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { getFile } from "@/lib/files";
import { createShare, normalizeEmails, parseAllowedEmails } from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crée un partage pour un fichier (admin uniquement).
 * Corps JSON : { emails: string[] | "a@x, b@y" }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  if (!getFile(id)) {
    return Response.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const rawEmails = (body as { emails?: unknown })?.emails;
  const emails = Array.isArray(rawEmails)
    ? rawEmails.map(String)
    : typeof rawEmails === "string"
      ? rawEmails.split(/[,\s;]+/)
      : [];

  const normalized = normalizeEmails(emails);
  if (normalized.length === 0) {
    return Response.json(
      { error: "Renseigne au moins une adresse e-mail." },
      { status: 400 },
    );
  }

  const share = createShare(id, normalized);
  const base = getAppUrl();

  return Response.json(
    {
      token: share.token,
      emails: parseAllowedEmails(share),
      created_at: share.created_at,
      url: base ? `${base}/s/${share.token}` : null,
    },
    { status: 201 },
  );
}
