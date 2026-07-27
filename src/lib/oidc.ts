import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getAppUrl } from "@/lib/config";

// Connexion OIDC (bouton « Se connecter avec GotYeah ») à côté de la porte email.
// Flux Authorization Code + PKCE piloté par le backend ; le callback vérifie que l'email
// est admin (ADMIN_EMAILS) puis pose la session Filer habituelle (JWT signé, cf. session.ts).
const ISSUER = (process.env.OIDC_ISSUER || "").replace(/\/$/, "");
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || "";

export const OIDC_BUTTON_LABEL =
  process.env.OIDC_BUTTON_LABEL || "Se connecter avec GotYeah";
export const OIDC_TX_COOKIE = "oidc_tx";
export const OIDC_TX_PATH = "/api/auth/oidc";
export const OIDC_SCOPES = "openid email profile";

export const oidcConfig = { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI };

export function oidcEnabled(): boolean {
  return !!(ISSUER && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

/** Porte email/ADMIN_EMAILS. Désactivable via LEGACY_LOGIN=off (comptes GotYeah only). */
export function legacyLoginEnabled(): boolean {
  return (process.env.LEGACY_LOGIN || "on").trim().toLowerCase() !== "off";
}

/**
 * Origine publique de CETTE pile — base de toutes les redirections internes.
 * `APP_URL` fait autorité (une valeur par environnement, jamais partagée) ;
 * repli sur l'origine du redirect_uri OIDC. L'ordre historique était l'inverse :
 * une seule variable fausse déviait ALORS l'aller SSO *et* le retour.
 */
export function appOrigin(): string {
  const app = getAppUrl();
  if (app) {
    try {
      return new URL(app).origin;
    } catch {
      // APP_URL malformée → on tombe sur le repli ci-dessous.
    }
  }
  try {
    return new URL(REDIRECT_URI).origin;
  } catch {
    return "";
  }
}

/**
 * Le redirect_uri OIDC ne pointe pas sur la pile décrite par `APP_URL`.
 * Sans ce contrôle, l'aller-retour SSO déposerait l'utilisateur sur l'AUTRE
 * environnement (prod ↔ preprod) sans le moindre signal. Faux si `APP_URL`
 * n'est pas définie : il n'y a alors rien à comparer.
 */
export function oidcOriginMismatch(): boolean {
  const app = getAppUrl();
  if (!app) return false;
  try {
    return new URL(REDIRECT_URI).origin !== new URL(app).origin;
  } catch {
    return true;
  }
}

/**
 * Hôte de la requête ≠ hôte de cette pile → on est servi sous un domaine qui
 * n'est pas le nôtre. Symptôme d'un mauvais routage EN AMONT (typiquement deux
 * conteneurs partageant un alias DNS Docker, cf. l'incident du 27/07/2026 où
 * une requête de prod sur deux atterrissait sur la preprod). Lancer le SSO dans
 * cet état expédierait l'utilisateur sur l'autre pile.
 * Renvoie l'hôte fautif, ou `null` si tout va bien.
 * NPM transmet `Host $host` ; on lit `X-Forwarded-Host` en priorité.
 */
export function foreignRequestHost(headers: Headers): string | null {
  let expected: string;
  try {
    expected = new URL(appOrigin()).host.toLowerCase();
  } catch {
    return null; // pas d'origine de référence : on ne peut rien affirmer
  }
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0];
  const host = (forwarded ?? headers.get("host") ?? "").trim().toLowerCase();
  if (!host) return null;
  return host === expected ? null : host;
}

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

let discoveryCache: Discovery | null = null;
export async function getDiscovery(): Promise<Discovery> {
  if (!discoveryCache) {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    discoveryCache = (await res.json()) as Discovery;
  }
  return discoveryCache;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function getJwks() {
  if (!jwks) {
    const disc = await getDiscovery();
    jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
  }
  return jwks;
}

/** Valide l'id_token (signature via JWKS, iss/aud/exp) puis le nonce. */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<JWTPayload> {
  const disc = await getDiscovery();
  const keys = await getJwks();
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: disc.issuer,
    audience: CLIENT_ID,
  });
  if (payload.nonce !== expectedNonce) throw new Error("nonce mismatch");
  return payload;
}
