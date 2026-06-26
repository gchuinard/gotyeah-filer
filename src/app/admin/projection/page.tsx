import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ProjectionScreen } from "@/components/projection-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Filer · Projection" };

/**
 * Fenêtre PUBLIC du mode présentateur (ouverte par la régie sur le 2e écran).
 * Sous `/admin/*` → déjà protégée par `proxy.ts` ; on revérifie ici (défense en
 * profondeur). Tout l'affichage est piloté côté client via `BroadcastChannel`.
 */
export default async function ProjectionWindowPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    redirect("/");
  }
  return <ProjectionScreen />;
}
