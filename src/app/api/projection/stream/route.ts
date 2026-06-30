import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { subscribe } from "@/lib/projection-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flux SSE de la télécommande : la RÉGIE et le TÉLÉPHONE s'abonnent à une room
 * (code d'appairage) pour RECEVOIR les messages de l'autre. L'émission se fait
 * par `POST /api/projection/cmd`. Admin uniquement.
 *
 * En-têtes anti-buffering (`no-transform`, `X-Accel-Buffering: no`) pour que les
 * événements traversent NPM/Cloudflare sans être mis en tampon.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return new Response("Accès refusé", { status: 403 });
  }
  const code = (request.nextUrl.searchParams.get("code") || "").trim();
  if (!/^\d{4,6}$/.test(code)) {
    return new Response("Code invalide", { status: 400 });
  }

  const id = crypto.randomUUID();
  const encoder = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (sse: string) => {
        try {
          controller.enqueue(encoder.encode(sse));
        } catch {
          /* flux déjà fermé */
        }
      };
      // 1er message : l'id attribué (chacun s'exclut des diffusions via cet id).
      enqueue(`data: ${JSON.stringify({ type: "hello", clientId: id })}\n\n`);
      unsub = subscribe(code, { id, enqueue });
      // Keep-alive = VRAI message `data:` (et non un commentaire `: ping`, que la
      // spec EventSource ne livre JAMAIS à `onmessage`). Côté client il sert de
      // signal de LIVENESS : un SSE figé « mort mais ouvert » (veille mobile,
      // bascule réseau, socket proxy demi-ouverte) ne déclenche pas `onerror` ;
      // mesurer l'âge du dernier message reçu (ce ping compris) permet de le
      // détecter → reconnexion forcée + repli polling. Intervalle < timeouts proxy.
      ping = setInterval(
        () => enqueue(`data: ${JSON.stringify({ type: "ping" })}\n\n`),
        15000,
      );
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
