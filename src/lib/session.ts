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
  /** Email saisi à la porte (normalisé), ou « lien-public ». */
  email: string;
  role: Role;
  /** Jetons des partages ouverts par un invité (absent pour un admin). Une
   * LISTE : quelqu'un qui reçoit plusieurs liens garde l'accès à chacun au lieu
   * de perdre le précédent à chaque nouveau lien. Bornée (cf. `withShare`). */
  shares?: string[];
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
    const { email, role, share, shares } = payload as Record<string, unknown>;
    if (typeof email !== "string" || (role !== "admin" && role !== "guest")) {
      return null;
    }
    // `shares` (liste) ; `share` (un seul jeton) = cookies posés avant la liste,
    // toujours acceptés.
    const tokens = [
      ...(Array.isArray(shares)
        ? shares.filter((s): s is string => typeof s === "string")
        : []),
      ...(typeof share === "string" ? [share] : []),
    ];
    return {
      email,
      role,
      ...(tokens.length > 0 ? { shares: [...new Set(tokens)] } : {}),
    };
  } catch {
    return null;
  }
}

/** Partages qu'un invité peut garder ouverts en même temps (taille du cookie). */
export const MAX_GUEST_SHARES = 20;

/**
 * Liste de partages d'un invité après l'ouverture de `token` : ceux qu'il avait
 * déjà (`keep` filtre les jetons encore valides), puis celui-ci en dernier ;
 * les plus anciens sortent au-delà de `MAX_GUEST_SHARES`.
 */
export function withShare(
  session: SessionPayload | null,
  token: string,
  keep: (token: string) => boolean = () => true,
): string[] {
  const previous =
    session?.role === "guest"
      ? (session.shares ?? []).filter((t) => t !== token && keep(t))
      : [];
  return [...previous, token].slice(-MAX_GUEST_SHARES);
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
