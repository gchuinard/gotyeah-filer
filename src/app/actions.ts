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

export type LoginState = { error?: string };

/**
 * Porte d'accès : valide l'email contre `ADMIN_EMAILS` et ouvre une session
 * admin. Aucune preuve de possession de l'email n'est demandée (compromis
 * assumé, cf. CONTEXT.md).
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!email) {
    return { error: "Renseigne ton adresse e-mail." };
  }
  if (!isAdminEmail(email)) {
    return { error: "Accès refusé pour cette adresse." };
  }

  const token = await signSession({ email, role: "admin" });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());

  redirect("/admin");
}

/** Déconnexion : supprime le cookie de session et renvoie à la porte. */
export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/");
}
