import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { publish, setLastState } from "@/lib/projection-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Émission d'un message de télécommande : diffusé à tous les abonnés SSE de la
 * room (`code`) sauf l'émetteur (`from`). Admin uniquement. Le corps est relayé
 * tel quel (`msg`) ; sa forme est validée côté client (cf. `RemoteMsg`).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }
  let body: { code?: unknown; from?: unknown; msg?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide." }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  const from = String(body.from ?? "");
  const msg = body.msg;
  if (!/^\d{4,6}$/.test(code) || !msg || typeof msg !== "object") {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const payload = JSON.stringify(msg);
  // Mémorise le dernier état pour le repli polling du téléphone (SSE dégradé).
  if ((msg as { type?: unknown }).type === "state") setLastState(code, payload);
  publish(code, from, payload);
  return new Response(null, { status: 204 });
}
