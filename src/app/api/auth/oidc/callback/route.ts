import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/config";
import { normalizeEmail } from "@/lib/email";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";
import {
  oidcEnabled,
  oidcConfig,
  getDiscovery,
  verifyIdToken,
  appOrigin,
  OIDC_TX_COOKIE,
  OIDC_TX_PATH,
} from "@/lib/oidc";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function GET(req: NextRequest) {
  const base = appOrigin();

  const fail = (code: string) => {
    const res = NextResponse.redirect(`${base}/?sso_error=${code}`);
    res.cookies.delete({ name: OIDC_TX_COOKIE, path: OIDC_TX_PATH });
    return res;
  };

  if (!oidcEnabled()) return fail("disabled");

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return fail("provider");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const tx = req.cookies.get(OIDC_TX_COOKIE)?.value;
  if (!code || !state || !tx) return fail("state");

  let parsed: { state: string; nonce: string; verifier: string };
  try {
    parsed = JSON.parse(Buffer.from(tx, "base64url").toString());
  } catch {
    return fail("state");
  }
  if (parsed.state !== state) return fail("state");

  // Échange du code (avec le code_verifier PKCE).
  let idToken: string;
  try {
    const disc = await getDiscovery();
    const tokenRes = await fetch(disc.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oidcConfig.REDIRECT_URI,
        client_id: oidcConfig.CLIENT_ID,
        client_secret: oidcConfig.CLIENT_SECRET,
        code_verifier: parsed.verifier,
      }),
      cache: "no-store",
    });
    if (!tokenRes.ok) return fail("token");
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) return fail("token");
    idToken = tokens.id_token;
  } catch {
    return fail("token");
  }

  // Validation de l'id_token (signature/iss/aud/exp + nonce).
  let claims;
  try {
    claims = await verifyIdToken(idToken, parsed.nonce);
  } catch {
    return fail("idtoken");
  }

  const email = normalizeEmail(str(claims.email));
  if (!email) return fail("noemail");
  if (claims.email_verified === false) return fail("unverified");
  // Filer est une porte admin : l'email OIDC doit figurer dans ADMIN_EMAILS.
  if (!isAdminEmail(email)) return fail("notadmin");

  const token = await signSession({ email, role: "admin" });
  const res = NextResponse.redirect(`${base}/admin`);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.delete({ name: OIDC_TX_COOKIE, path: OIDC_TX_PATH });
  return res;
}
