import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

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

/** Origine publique, dérivée du redirect_uri (repli APP_URL) — base des redirections. */
export function appOrigin(): string {
  try {
    return new URL(REDIRECT_URI).origin;
  } catch {
    return (process.env.APP_URL || "").replace(/\/+$/, "");
  }
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
