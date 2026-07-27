/**
 * Extrait un message lisible d'une réponse HTTP en échec.
 *
 * Les routes de l'app répondent soit en JSON (`{ error: "…" }`), soit en texte
 * brut (« Accès refusé », « Introuvable »). On récupère ce que le serveur dit
 * plutôt que d'inventer un message générique.
 *
 * Le cas 403 est traité à part : c'est le symptôme d'une session invalide (ou
 * servie par une autre instance), et c'est précisément l'erreur qui, faute
 * d'être affichée, a fait passer un incident de routage pour une panne de
 * l'application pendant deux semaines. On dit quoi faire, pas juste quoi.
 */
export async function apiErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  if (res.status === 403) {
    return "Accès refusé — ta session n'est plus valide. Déconnecte-toi puis reconnecte-toi.";
  }

  try {
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim() !== "") {
        return body.error;
      }
    } else {
      const text = (await res.text()).trim();
      // Garde-fou : on n'affiche pas une page d'erreur HTML entière.
      if (text !== "" && text.length <= 200 && !text.startsWith("<")) {
        return text;
      }
    }
  } catch {
    // Corps illisible ou déjà consommé : on retombe sur le message générique.
  }

  return `${fallback} (HTTP ${res.status})`;
}
