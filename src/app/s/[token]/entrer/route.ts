import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  withShare,
} from "@/lib/session";
import { getActiveShare } from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrée sur un LIEN PUBLIC : pose la même session invité que la porte e-mail
 * (`enterShare`), scopée à ce jeton, puis renvoie sur la page du partage. Toutes
 * les routes (aperçu, téléchargement reprenable, zip) fonctionnent donc sans
 * changement : elles vérifient cette session via `canAccessFile`.
 *
 * Une Route Handler, car un Server Component ne peut pas poser de cookie. Le
 * retour porte `?e=1` : si le cookie n'a pas pu être posé (cookies bloqués), la
 * page affiche un message au lieu de renvoyer ici en boucle.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const back = `/s/${encodeURIComponent(token)}`;
  const share = getActiveShare(token);

  // Partage inconnu, expiré ou protégé par e-mail : la page s'en charge.
  if (!share || share.public !== 1) {
    return new Response(null, { status: 303, headers: { Location: back } });
  }

  // Un admin garde sa session (il a déjà accès à tout). Un invité AJOUTE ce
  // partage à ceux qu'il a déjà ouverts : recevoir plusieurs liens ne coupe pas
  // l'accès aux précédents.
  const session = await getSession();
  if (session?.role !== "admin") {
    const t = await signSession({
      email: session?.email ?? "lien-public",
      role: "guest",
      shares: withShare(session, token, (tk) => !!getActiveShare(tk)),
    });
    (await cookies()).set(SESSION_COOKIE, t, sessionCookieOptions());
  }

  return new Response(null, {
    status: 303,
    headers: { Location: `${back}?e=1`, "Cache-Control": "no-store" },
  });
}
