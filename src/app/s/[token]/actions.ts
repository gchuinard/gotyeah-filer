"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/config";
import { normalizeEmail } from "@/lib/email";
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
 * est admin, sinon invité (ce partage
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

  if (isAdminEmail(email)) {
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

  return { error: "Cette adresse n'a pas accès à ce partage." };
}
