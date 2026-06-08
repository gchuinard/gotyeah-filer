import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret } from "@/lib/config";

/**
 * Session stateless : un JWT HS256 signé (PAS chiffré) posé dans un cookie
 * httpOnly. Le payload est lisible (base64) → on n'y met rien de sensible :
 * juste l'email, le rôle, et l'expiration.
 *
 * Ce module évite `next/headers` pour rester utilisable aussi bien dans les
 * Server Actions que dans `proxy.ts`.
 */

export const SESSION_COOKIE = "filer_session";

/** Durée de vie de la session : 30 jours (en secondes, pour le cookie). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const ALG = "HS256";
const EXPIRATION = "30d";

export type Role = "admin" | "guest";

export type SessionPayload = {
  /** Email saisi à la porte (normalisé). */
  email: string;
  role: Role;
  /** Token du partage pour un invité (Phase 4). Absent pour un admin. */
  share?: string;
};

/** Signe un JWT HS256 contenant le payload de session (exp à 30 jours). */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRATION)
    .sign(getSessionSecret());
}

/** Vérifie signature + expiration. Retourne le payload, ou null si invalide. */
export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: [ALG],
    });
    const { email, role, share } = payload as Record<string, unknown>;
    if (typeof email !== "string" || (role !== "admin" && role !== "guest")) {
      return null;
    }
    return {
      email,
      role,
      ...(typeof share === "string" ? { share } : {}),
    };
  } catch {
    return null;
  }
}

/** Options du cookie de session : httpOnly, secure (en prod), sameSite lax. */
export function sessionCookieOptions(maxAge: number = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    // En prod l'app est derrière HTTPS (Cloudflare/NPM) ; en dev (http) on
    // laisse `secure` à false pour que le cookie soit accepté.
    secure: process.env.NODE_ENV === "production",
    // `lax` (et non `strict`) : indispensable pour que le cookie soit envoyé
    // quand un invité arrive via un lien de partage externe (Phase 4).
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
