"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/config";
import { normalizeEmail } from "@/lib/email";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";
import { getShare, shareAllowsEmail } from "@/lib/shares";

export type EnterState = { error?: string };

/**
 * « Entrée » d'un invité sur un partage : on compare l'email à la liste
 * autorisée du partage (ou aux admins). Aucune preuve de possession de l'email
 * (compromis assumé). En cas de succès, on pose une session — admin si l'email
 * est admin, sinon invité scopé à ce token — puis on recharge la page.
 */
export async function enterShare(
  _prev: EnterState,
  formData: FormData,
): Promise<EnterState> {
  const token = String(formData.get("token") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!email) return { error: "Renseigne ton adresse e-mail." };

  const share = getShare(token);
  if (!share) return { error: "Lien invalide ou révoqué." };

  const store = await cookies();

  if (isAdminEmail(email)) {
    const t = await signSession({ email, role: "admin" });
    store.set(SESSION_COOKIE, t, sessionCookieOptions());
    redirect(`/s/${token}`);
  }

  if (shareAllowsEmail(share, email)) {
    const t = await signSession({ email, role: "guest", share: token });
    store.set(SESSION_COOKIE, t, sessionCookieOptions());
    redirect(`/s/${token}`);
  }

  return { error: "Cette adresse n'a pas accès à ce partage." };
}
