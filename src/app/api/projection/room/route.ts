import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { hasRegie } from "@/lib/projection-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ce code d'appairage est-il ACTIF, c'est-à-dire tenu par une régie ?
 * Interrogé par la télécommande AVANT de s'ouvrir : sans ça, saisir un code
 * inconnu ouvrait l'interface sur une projection vide (s'abonner au flux crée
 * la room, mais aucune régie n'y répond jamais). Admin uniquement.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }
  const code = (request.nextUrl.searchParams.get("code") || "").trim();
  if (!/^\d{4,6}$/.test(code)) {
    return new Response("Code invalide", { status: 400 });
  }
  // `no-store` : la présence d'une régie change d'une seconde à l'autre, aucun
  // cache intermédiaire ne doit figer la réponse (même raison que la route state).
  return Response.json(
    { active: hasRegie(code) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
