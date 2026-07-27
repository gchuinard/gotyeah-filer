import { randomBytes, createHash } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  oidcEnabled,
  getDiscovery,
  oidcConfig,
  appOrigin,
  oidcOriginMismatch,
  foreignRequestHost,
  OIDC_TX_COOKIE,
  OIDC_TX_PATH,
  OIDC_SCOPES,
} from "@/lib/oidc";

const b64url = (buf: Buffer) => buf.toString("base64url");

export async function GET(req: NextRequest) {
  if (!oidcEnabled()) {
    return NextResponse.redirect(`${appOrigin()}/?sso_error=disabled`);
  }

  // Garde-fou n°1 — configuration : le redirect_uri ne pointe pas sur cette
  // pile. On échoue AVANT de partir chez l'IdP, qui nous ramènerait ailleurs.
  if (oidcOriginMismatch()) {
    return NextResponse.redirect(`${appOrigin()}/?sso_error=misconfig`);
  }

  // Garde-fou n°2 — routage : la requête arrive sous un domaine qui n'est pas
  // le nôtre (alias DNS partagé en amont). Surtout PAS de redirection ici — elle
  // renverrait justement l'utilisateur sur l'autre pile, ce qu'on veut empêcher.
  // Une erreur franche est la seule réponse qui rende le problème visible.
  const foreign = foreignRequestHost(req.headers);
  if (foreign) {
    return new NextResponse(
      `Mauvais routage : cette instance de Filer répond pour ${appOrigin()}, ` +
        `mais la requête est arrivée sous « ${foreign} ». ` +
        `Connexion interrompue pour ne pas t'envoyer sur un autre environnement. ` +
        `Vérifier le reverse proxy et les alias réseau Docker.`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const disc = await getDiscovery();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());

  const authUrl = new URL(disc.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", oidcConfig.CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", oidcConfig.REDIRECT_URI);
  authUrl.searchParams.set("scope", OIDC_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(
    OIDC_TX_COOKIE,
    Buffer.from(JSON.stringify({ state, nonce, verifier })).toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: OIDC_TX_PATH,
    },
  );
  return res;
}
