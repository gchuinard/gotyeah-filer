import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { RemoteControl } from "@/components/remote-control";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Filer · Télécommande" };

/**
 * Télécommande de projection (à ouvrir sur le téléphone). Sous `/admin/*` → déjà
 * protégée par `proxy.ts` ; on revérifie ici (défense en profondeur). Tout passe
 * ensuite par le relais SSE (`/api/projection/*`) avec le code d'appairage.
 */
export default async function RemotePage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    redirect("/");
  }
  return <RemoteControl />;
}
