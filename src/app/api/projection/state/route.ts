import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getLastState } from "@/lib/projection-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dernier état connu d'une room (JSON), pour le **repli polling** de la
 * télécommande quand son flux SSE est dégradé (les POST/GET passent, le SSE non).
 * Admin uniquement. Renvoie une réponse vide si aucun état mémorisé.
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
  const json = getLastState(code);
  // Pas d'état mémorisé → 204 (pas de corps) plutôt qu'un corps vide annoncé JSON.
  if (!json) return new Response(null, { status: 204 });
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
