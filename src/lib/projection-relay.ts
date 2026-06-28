/* Relais SERVEUR (en mémoire) de la télécommande de projection. Une « room » =
 * un code d'appairage ; la régie ET le téléphone s'y abonnent (SSE) et y publient
 * (POST). État VOLATILE (perdu au redémarrage) — suffisant pour une session de
 * spectacle, zéro base. Un seul conteneur (Pi) → une seule instance, donc OK.
 *
 * On garde le registre sur `globalThis` pour survivre au hot-reload en dev. */

type Sub = { id: string; enqueue: (sse: string) => void };

const g = globalThis as unknown as {
  __projectionRooms?: Map<string, Set<Sub>>;
  __projectionState?: Map<string, string>;
};
function rooms(): Map<string, Set<Sub>> {
  return (g.__projectionRooms ??= new Map<string, Set<Sub>>());
}
// Dernier état (JSON) connu par room : sert de repli en polling au téléphone
// quand son flux SSE est dégradé (les POST/GET passent, le SSE non).
function lastStates(): Map<string, string> {
  return (g.__projectionState ??= new Map<string, string>());
}

/** Borne le nombre de rooms mémorisées (anti-fuite si une room n'est jamais
 * nettoyée, ex. état mémorisé sans abonné SSE). Largement suffisant : en pratique
 * une seule room active à la fois. */
const MAX_STATES = 50;

/** Mémorise le dernier état d'une room (poussé par la régie). LRU : la room
 * la plus récemment mise à jour reste, on évince la plus ancienne au-delà du cap. */
export function setLastState(code: string, payloadJson: string): void {
  const m = lastStates();
  m.delete(code); // ré-insère en fin → ordre = ancienneté de dernière mise à jour
  m.set(code, payloadJson);
  if (m.size > MAX_STATES) {
    const oldest = m.keys().next().value;
    if (oldest !== undefined) m.delete(oldest);
  }
}
/** Dernier état connu d'une room (ou null). */
export function getLastState(code: string): string | null {
  return lastStates().get(code) ?? null;
}

/** Abonne un client à une room ; renvoie la fonction de désabonnement. */
export function subscribe(code: string, sub: Sub): () => void {
  const r = rooms();
  let set = r.get(code);
  if (!set) {
    set = new Set<Sub>();
    r.set(code, set);
  }
  set.add(sub);
  return () => {
    const s = rooms().get(code);
    if (!s) return;
    s.delete(sub);
    if (s.size === 0) {
      rooms().delete(code);
      lastStates().delete(code); // plus personne dans la room → on oublie l'état
    }
  };
}

/** Diffuse un message (déjà sérialisé JSON) aux abonnés de la room sauf l'émetteur. */
export function publish(
  code: string,
  fromId: string,
  payloadJson: string,
): void {
  const set = rooms().get(code);
  if (!set) return;
  const framed = `data: ${payloadJson}\n\n`;
  for (const s of set) {
    if (s.id !== fromId) {
      try {
        s.enqueue(framed);
      } catch {
        /* connexion fermée entre-temps */
      }
    }
  }
}
