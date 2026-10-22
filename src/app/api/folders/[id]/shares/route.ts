import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { getFolder } from "@/lib/folders";
import {
  createFolderShare,
  createPublicShare,
  normalizeEmails,
  parsePublicLinkDays,
  toShareDto,
} from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crée un partage pour un dossier entier (admin uniquement).
 * Corps JSON : { emails: string[] | "a@x, b@y" }, OU { public: true, days }
 * pour un lien public (sans e-mail ; `days` ∈ 1 | 7 | 30, null = sans
 * expiration, absent = 7).
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
  if (!getFolder(id)) {
    return Response.json({ error: "Dossier introuvable." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }

  const base = getAppUrl();

  if ((body as { public?: unknown })?.public === true) {
    const days = parsePublicLinkDays((body as { days?: unknown }).days);
    if (days === undefined) {
      return Response.json({ error: "Durée invalide." }, { status: 400 });
    }
    const share = createPublicShare({ folderId: id }, days);
    return Response.json(
      { ...toShareDto(share), url: base ? `${base}/s/${share.token}` : null },
      { status: 201 },
    );
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

  const share = createFolderShare(id, normalized);

  return Response.json(
    { ...toShareDto(share), url: base ? `${base}/s/${share.token}` : null },
    { status: 201 },
  );
}
