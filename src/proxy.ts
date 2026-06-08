import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Protège les routes admin : vérifie le cookie de session (signature + exp +
 * rôle) à chaque requête, et redirige vers la porte (`/`) si invalide.
 * Next 16 : `proxy` remplace `middleware` et tourne en runtime Node.js (jose OK).
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (session?.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
