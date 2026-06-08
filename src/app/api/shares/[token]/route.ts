import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteShare } from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Révoque un partage (admin uniquement). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }

  const { token } = await params;
  const ok = deleteShare(token);
  return ok
    ? new Response(null, { status: 204 })
    : new Response("Introuvable", { status: 404 });
}
