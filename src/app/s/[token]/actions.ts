"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/config";
import { normalizeEmail } from "@/lib/email";
import { legacyLoginEnabled } from "@/lib/oidc";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  withShare,
} from "@/lib/session";
import { getActiveShare, shareAllowsEmail } from "@/lib/shares";

export type EnterState = { error?: string };

/**
 * « Entrée » d'un invité sur un partage : on compare l'email à la liste
 * autorisée du partage (ou aux admins). Aucune preuve de possession de l'email
 * (compromis assumé). En cas de succès, on pose une session — admin si l'email
 * est admin ET que la connexion par email est permise, sinon invité (ce partage
 * s'ajoute à ceux qu'il avait déjà ouverts) — puis on recharge la page.
 */
export async function enterShare(
  _prev: EnterState,
  formData: FormData,
): Promise<EnterState> {
  const token = String(formData.get("token") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!email) return { error: "Renseigne ton adresse e-mail." };

  const share = getActiveShare(token);
  if (!share) return { error: "Lien invalide, expiré ou révoqué." };

  const store = await cookies();

  // Session ADMIN par simple e-mail : seulement si la connexion par e-mail est
  // permise (comme la porte d'accueil, cf. `login`). Avec LEGACY_LOGIN=off,
  // n'importe quel jeton de partage + l'adresse admin donnaient sinon un accès
  // admin complet — d'autant plus facile qu'un lien public circule.
  if (isAdminEmail(email) && legacyLoginEnabled()) {
    const t = await signSession({ email, role: "admin" });
    store.set(SESSION_COOKIE, t, sessionCookieOptions());
    redirect(`/s/${token}`);
  }

  if (shareAllowsEmail(share, email)) {
    const session = await getSession();
    const t = await signSession({
      email,
      role: "guest",
      shares: withShare(session, token, (tk) => !!getActiveShare(tk)),
    });
    store.set(SESSION_COOKIE, t, sessionCookieOptions());
    redirect(`/s/${token}`);
  }

  if (isAdminEmail(email)) {
    return {
      error:
        "Connexion admin par e-mail désactivée : utilise « Se connecter avec GotYeah ».",
    };
  }
  return { error: "Cette adresse n'a pas accès à ce partage." };
}
