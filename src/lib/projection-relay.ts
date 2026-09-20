/* Relais SERVEUR (en mémoire) de la télécommande de projection. Une « room » =
 * un code d'appairage ; la régie ET le téléphone s'y abonnent (SSE) et y publient
 * (POST). État VOLATILE (perdu au redémarrage) — suffisant pour une session de
 * spectacle, zéro base. Un seul conteneur (Pi) → une seule instance, donc OK.
 *
 * On garde le registre sur `globalThis` pour survivre au hot-reload en dev. */

/** Qui est abonné : la RÉGIE (celle qui mène l'écran public) ou un TÉLÉPHONE.
 *  Sert à répondre « ce code est-il actif ? » avant d'ouvrir la télécommande. */
export type SubRole = "regie" | "remote";

type Sub = { id: string; role: SubRole; enqueue: (sse: string) => void };

const g = globalThis as unknown as {
  __projectionRooms?: Map<string, Set<Sub>>;
  __projectionState?: Map<string, string>;
  __projectionRegieSeen?: Map<string, number>;
};
function rooms(): Map<string, Set<Sub>> {
  return (g.__projectionRooms ??= new Map<string, Set<Sub>>());
}
// Dernier état (JSON) connu par room : sert de repli en polling au téléphone
// quand son flux SSE est dégradé (les POST/GET passent, le SSE non).
function lastStates(): Map<string, string> {
  return (g.__projectionState ??= new Map<string, string>());
}

/** Dernière fois (ms) qu'une RÉGIE a été vue sur une room. Volontairement SÉPARÉ
 * de `lastStates` : cette mémoire doit SURVIVRE à la destruction de la room (cf.
 * `hasRegie`), alors que l'état, lui, est oublié quand la room se vide. */
function regieSeen(): Map<string, number> {
  return (g.__projectionRegieSeen ??= new Map<string, number>());
}

/** Borne le nombre de rooms mémorisées (anti-fuite si une room n'est jamais
 * nettoyée, ex. état mémorisé sans abonné SSE). Largement suffisant : en pratique
 * une seule room active à la fois. */
const MAX_STATES = 50;

/**
 * Tolérance après la disparition de l'abonnement SSE d'une régie pendant laquelle
 * son code reste valable. La régie COUPE ET RECRÉE son propre flux (watchdog de
 * liveness, `projection-regie.tsx`) et un intermédiaire peut le faire à sa place :
 * sans ce délai, appairer un téléphone pile dans ce trou refuserait un code
 * pourtant affiché à l'écran. Tenu sous les 35 s du watchdog pour qu'une régie
 * réellement partie cesse vite d'être annoncée active.
 */
const REGIE_GRACE_MS = 15000;

/** Insertion LRU dans une des maps bornées ci-dessus (ré-insère en fin → l'ordre
 * des clés suit l'ancienneté de mise à jour, on évince la plus ancienne). */
function lruSet<V>(m: Map<string, V>, code: string, value: V): void {
  m.delete(code);
  m.set(code, value);
  if (m.size > MAX_STATES) {
    const oldest = m.keys().next().value;
    if (oldest !== undefined) m.delete(oldest);
  }
}

/** Mémorise le dernier état d'une room (poussé par la régie). */
export function setLastState(code: string, payloadJson: string): void {
  lruSet(lastStates(), code, payloadJson);
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
  if (sub.role === "regie") lruSet(regieSeen(), code, Date.now());
  return () => {
    // Horodate le DÉPART de la régie : c'est ce qui ouvre la fenêtre de
    // tolérance pendant qu'elle se reconnecte (cf. REGIE_GRACE_MS).
    if (sub.role === "regie") lruSet(regieSeen(), code, Date.now());
    const s = rooms().get(code);
    if (!s) return;
    s.delete(sub);
    if (s.size === 0) {
      rooms().delete(code);
      lastStates().delete(code); // plus personne dans la room → on oublie l'état
      // `regieSeen` N'EST PAS effacé ici : sans téléphone connecté, la room
      // disparaît entièrement le temps que la régie se reconnecte, et l'effacer
      // rendrait la tolérance inopérante dans le cas le plus courant.
    }
  };
}

/**
 * Une RÉGIE tient-elle cette room ? S'abonner CRÉE la room (cf. `subscribe`) :
 * un code inconnu donnerait donc une room bien réelle mais vide de régie, et le
 * téléphone attendrait indéfiniment un état que personne n'enverra. C'est la
 * présence d'une régie — pas l'existence de la room — qui rend un code valable.
 */
export function hasRegie(code: string): boolean {
  const set = rooms().get(code);
  if (set) for (const s of set) if (s.role === "regie") return true;
  // Pas d'abonnement régie VIVANT : elle est peut-être en train de se reconnecter.
  const seen = regieSeen().get(code);
  return seen !== undefined && Date.now() - seen < REGIE_GRACE_MS;
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
