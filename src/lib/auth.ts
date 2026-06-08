import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  verifySession,
  type SessionPayload,
} from "@/lib/session";

/**
 * Lit et vérifie la session depuis le cookie (Server Components / Actions).
 * Retourne null si absente ou invalide.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
