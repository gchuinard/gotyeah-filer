/* File d'envoi PAR MORCEAUX, côté navigateur (protocole :
 * `src/lib/upload-protocol.ts`, serveur : `app/api/upload/sessions/*`).
 *
 * Module JS hors React (lu par `useSyncExternalStore`) : la file vit tant que
 * l'onglet vit, même quand `UploadZone` est démontée (vue « Accueil ») — un
 * envoi de 48 Go dure des heures, on ne le perd pas pour un changement de vue.
 * Pas de reprise après rechargement (décision produit) : à la place, un
 * avertissement avant de quitter la page tant qu'un envoi tourne.
 *
 * Robustesse : la position fait foi CÔTÉ SERVEUR. Après tout échec (réseau,
 * 5xx, 408, 409, 423, chien de garde), on attend (backoff plafonné à 30 s,
 * réveil anticipé sur `online`), on vérifie que le fichier source est encore
 * lisible, puis on relit l'état par GET avant de renvoyer quoi que ce soit.
 * Les réessais sont sans fin ; seuls 400/403/404/410/413/507 (ou un fichier
 * illisible) arrêtent l'envoi. */

import { apiErrorMessage } from "@/lib/api-error";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_OFFSET_HEADER,
  type UploadInitResponse,
  type UploadStatus,
} from "@/lib/upload-protocol";

export type UploadState =
  | "queued"
  | "uploading"
  | "retrying"
  | "done"
  | "error";

/** Instantané d'un envoi, tel que l'affiche l'UI (immuable). */
export type UploadItem = {
  key: string;
  name: string;
  size: number;
  /** Octets confirmés par le serveur + octets du morceau en vol. */
  sent: number;
  state: UploadState;
  /** Débit (octets/s) en moyenne glissante, null tant qu'inconnu. */
  speed: number | null;
  /** Erreur terminale, ou raison du réessai en cours. */
  message?: string;
};

/** Envois simultanés (fichiers) ; les morceaux d'un fichier restent séquentiels. */
const MAX_PARALLEL = 3;
/** Aucune progression pendant ce délai → on abandonne le morceau et on sonde. */
const STALL_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
/** Échecs d'affilée tolérés quand le serveur répond mais que le morceau ne
 * passe pas (~6 min avec le backoff plafonné) avant de passer en erreur. */
const MAX_STUCK_RETRIES = 12;
/** Fenêtre de la moyenne glissante du débit. */
const SPEED_WINDOW_MS = 10_000;
/** Notifications de l'UI limitées à ~4 par seconde pendant la progression. */
const EMIT_INTERVAL_MS = 250;
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 410, 413, 507]);

type Job = {
  key: string;
  file: File;
  folderId: string | null;
  fingerprint: string;
  sessionId: string | null;
  /** Octets confirmés par le serveur. */
  confirmed: number;
  /** Octets du morceau en cours déjà partis (progression XHR). */
  inFlight: number;
  state: UploadState;
  message?: string;
  canceled: boolean;
  xhr: XMLHttpRequest | null;
  /** Interrompt l'attente du backoff (annulation, retour du réseau). */
  wake: (() => void) | null;
  /** Exécution en cours de `runJob` (pour attendre sa fin à la déconnexion). */
  run: Promise<void> | null;
  samples: { t: number; bytes: number }[];
};

const jobs: Job[] = [];
const listeners = new Set<() => void>();
const completedListeners = new Set<() => void>();
const EMPTY: UploadItem[] = [];
let snapshot: UploadItem[] = EMPTY;
let emitTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Store (useSyncExternalStore) ───────────────────────────────────────────

export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUploadsSnapshot(): UploadItem[] {
  return snapshot;
}

export function getUploadsServerSnapshot(): UploadItem[] {
  return EMPTY;
}

/** Abonnement aux envois terminés (pour rafraîchir la liste des fichiers). */
export function onUploadCompleted(listener: () => void): () => void {
  completedListeners.add(listener);
  return () => {
    completedListeners.delete(listener);
  };
}

export function isActiveState(state: UploadState): boolean {
  return state === "queued" || state === "uploading" || state === "retrying";
}

export function hasActiveUploads(): boolean {
  return jobs.some((j) => isActiveState(j.state));
}

/** Une session serveur reste ouverte (envoi actif ou en erreur). */
export function hasOpenUploadSessions(): boolean {
  return jobs.some(hasOpenSession);
}

function speedOf(job: Job): number | null {
  const s = job.samples;
  if (s.length < 2) return null;
  const first = s[0];
  const last = s[s.length - 1];
  const dt = last.t - first.t;
  return dt >= 1000 ? ((last.bytes - first.bytes) * 1000) / dt : null;
}

function rebuild(): void {
  emitTimer = null;
  snapshot = jobs.map((j) => ({
    key: j.key,
    name: j.file.name,
    size: j.file.size,
    sent: Math.min(j.file.size, j.confirmed + j.inFlight),
    state: j.state,
    speed: j.state === "uploading" ? speedOf(j) : null,
    message: j.message,
  }));
  updateGuards();
  for (const l of listeners) l();
}

/** Publie l'état : immédiat pour un changement d'état, regroupé pour la
 * progression (un morceau émet des dizaines d'événements par seconde). */
function emit(immediate = false): void {
  if (immediate) {
    if (emitTimer) clearTimeout(emitTimer);
    rebuild();
  } else if (!emitTimer) {
    emitTimer = setTimeout(rebuild, EMIT_INTERVAL_MS);
  }
}

function recordProgress(job: Job): void {
  const now = Date.now();
  job.samples.push({ t: now, bytes: job.confirmed + job.inFlight });
  while (job.samples.length > 2 && now - job.samples[0].t > SPEED_WINDOW_MS) {
    job.samples.shift();
  }
}

// ─── API ────────────────────────────────────────────────────────────────────

/** Ajoute des fichiers à la file. Un fichier déjà en cours (même nom, taille,
 * date) n'est pas ajouté une seconde fois. */
export function enqueueUploads(files: File[], folderId: string | null): void {
  for (const file of files) {
    const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
    if (jobs.some((j) => j.fingerprint === fingerprint && isActiveState(j.state))) {
      continue;
    }
    jobs.push({
      key: crypto.randomUUID(),
      file,
      folderId,
      fingerprint,
      sessionId: null,
      confirmed: 0,
      inFlight: 0,
      state: "queued",
      canceled: false,
      xhr: null,
      wake: null,
      run: null,
      samples: [],
    });
  }
  emit(true);
  pump();
}

/** Annule un envoi (en cours, en attente ou en erreur) et le retire de la liste. */
export function cancelUpload(key: string): void {
  const job = jobs.find((j) => j.key === key);
  if (!job) return;
  job.canceled = true;
  job.xhr?.abort();
  job.wake?.();
  // Session pas encore ouverte (POST en vol) : `runJob` la supprimera dès
  // qu'il en recevra l'id.
  if (job.sessionId && job.state !== "done") void deleteSession(job.sessionId);
  jobs.splice(jobs.indexOf(job), 1);
  emit(true);
  pump();
}

function deleteSession(id: string): Promise<void> {
  return fetch(`/api/upload/sessions/${id}`, {
    method: "DELETE",
    keepalive: true,
    signal: AbortSignal.timeout(5000),
  }).then(
    () => {},
    () => {},
  );
}

/** Annule tous les envois non terminés (avant une déconnexion), y compris ceux
 * en erreur, et attend la suppression des sessions côté serveur (bornée à
 * quelques secondes). Tout est marqué annulé AVANT d'être retiré : sinon
 * chaque place libérée relancerait un envoi en attente pendant l'annulation. */
export async function cancelAllUploads(): Promise<void> {
  const pending = jobs.filter((j) => j.state !== "done");
  for (const job of pending) {
    job.canceled = true;
    job.xhr?.abort();
    job.wake?.();
  }
  const ids = pending.flatMap((j) => (j.sessionId ? [j.sessionId] : []));
  const runs = pending.flatMap((j) => (j.run ? [j.run] : []));
  for (const job of pending) jobs.splice(jobs.indexOf(job), 1);
  emit(true);
  // Un envoi dont l'ouverture était en vol supprime lui-même sa session :
  // on lui laisse le temps de le faire avant que la déconnexion n'efface le
  // cookie (après, le DELETE prendrait un 403).
  await Promise.race([
    Promise.allSettled(runs),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  await Promise.allSettled(ids.map(deleteSession));
}

/** Relance un envoi en erreur (repart de la position serveur si la session
 * existe encore, sinon de zéro). */
export function retryUpload(key: string): void {
  const job = jobs.find((j) => j.key === key);
  if (!job || job.state !== "error") return;
  job.state = "queued";
  job.message = undefined;
  emit(true);
  pump();
}

/** Retire de la liste les envois terminés. */
export function clearFinishedUploads(): void {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].state === "done") jobs.splice(i, 1);
  }
  emit(true);
}

// ─── Moteur ─────────────────────────────────────────────────────────────────

function pump(): void {
  let running = jobs.filter(
    (j) => j.state === "uploading" || j.state === "retrying",
  ).length;
  for (const job of jobs) {
    if (running >= MAX_PARALLEL) break;
    if (job.state !== "queued") continue;
    running += 1;
    job.state = "uploading";
    job.run = runJob(job);
  }
  emit(true);
}

class TerminalError extends Error {}

function sleep(job: Job, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      job.wake = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    job.wake = done;
  });
}

function backoff(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

/** Réponse XHR → `Response`, pour réutiliser `apiErrorMessage`. */
function xhrToResponse(xhr: XMLHttpRequest): Response {
  const noBody = [204, 205, 304].includes(xhr.status);
  return new Response(noBody ? null : xhr.responseText, {
    status: xhr.status,
    headers: { "content-type": xhr.getResponseHeader("content-type") ?? "" },
  });
}

async function terminalMessage(res: Response): Promise<string> {
  if (res.status === 413) {
    const msg = await apiErrorMessage(res, "Fichier refusé");
    return msg.includes("HTTP 413")
      ? "Morceau refusé par le proxy (413) — vérifier la limite de NPM."
      : msg;
  }
  if (res.status === 404 || res.status === 410) {
    return "Envoi expiré ou annulé côté serveur.";
  }
  return apiErrorMessage(res, "Échec de l'envoi");
}

type ChunkResult =
  | { kind: "ok"; status: UploadStatus }
  | { kind: "http"; res: Response; offset: number | null }
  | { kind: "network" }
  | { kind: "aborted" };

/** Envoie un morceau par XHR (progression + abort), sous chien de garde. */
function sendChunk(job: Job, offset: number, end: number): Promise<ChunkResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    let lastActivity = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) {
        stalled = true;
        xhr.abort();
      }
    }, 5000);
    const finish = (r: ChunkResult) => {
      clearInterval(watchdog);
      job.xhr = null;
      job.inFlight = 0;
      resolve(r);
    };

    xhr.open("PUT", `/api/upload/sessions/${job.sessionId}`);
    xhr.setRequestHeader(UPLOAD_OFFSET_HEADER, String(offset));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      lastActivity = Date.now();
      job.inFlight = e.loaded;
      recordProgress(job);
      emit();
    };
    // Corps parti : on laisse encore STALL_MS au serveur pour répondre.
    xhr.upload.onload = () => {
      lastActivity = Date.now();
    };
    xhr.onload = () => {
      let body: UploadStatus | null = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadStatus;
      } catch {
        body = null;
      }
      if (xhr.status === 200 && body && Number.isSafeInteger(body.offset)) {
        finish({ kind: "ok", status: body });
      } else {
        const offset =
          body && Number.isSafeInteger(body.offset) ? body.offset : null;
        finish({ kind: "http", res: xhrToResponse(xhr), offset });
      }
    };
    xhr.onerror = () => finish({ kind: "network" });
    xhr.onabort = () => finish(stalled ? { kind: "network" } : { kind: "aborted" });
    xhr.send(job.file.slice(offset, end));
  });
}

async function openSession(job: Job): Promise<string> {
  const res = await fetch("/api/upload/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: job.file.name,
      size: job.file.size,
      mime: job.file.type || "application/octet-stream",
      folderId: job.folderId,
      lastModified: job.file.lastModified,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 201) {
    return ((await res.json()) as UploadInitResponse).id;
  }
  if (TERMINAL_STATUSES.has(res.status)) {
    throw new TerminalError(await terminalMessage(res));
  }
  throw new Error(`HTTP ${res.status}`); // réessayable
}

/** Relit l'état serveur : position, ou fin. null = serveur injoignable. */
async function probe(job: Job): Promise<UploadStatus | null> {
  try {
    const res = await fetch(`/api/upload/sessions/${job.sessionId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return (await res.json()) as UploadStatus;
    if (TERMINAL_STATUSES.has(res.status)) {
      throw new TerminalError(await terminalMessage(res));
    }
    return null;
  } catch (err) {
    if (err instanceof TerminalError) throw err;
    return null;
  }
}

/** Le prochain morceau du fichier source est-il encore lisible (disque
 * débranché, fichier modifié ou déplacé depuis sa sélection → NotReadableError) ?
 * On lit le morceau ENTIER : une erreur de lecture plus loin dans la tranche
 * ferait sinon échouer chaque PUT comme une simple coupure réseau. */
async function assertReadable(job: Job, offset: number): Promise<void> {
  if (offset >= job.file.size) return;
  try {
    await job.file
      .slice(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, job.file.size))
      .arrayBuffer();
  } catch {
    throw new TerminalError(
      "Le fichier source n'est plus lisible (déplacé, modifié ou disque débranché).",
    );
  }
}

function markRetrying(job: Job, message: string): void {
  job.state = "retrying";
  job.message = message;
  job.samples = [];
  emit(true);
}

async function runJob(job: Job): Promise<void> {
  let attempt = 0;
  /** Échecs d'affilée alors que le serveur répond et que rien n'avance. */
  let stuck = 0;
  try {
    // Ouverture de la session (un nouvel essai après erreur repart de la
    // position serveur si la session existe encore).
    if (job.sessionId) {
      const st = await probe(job).catch((err) => {
        if (err instanceof TerminalError) return "gone" as const;
        throw err;
      });
      if (st === "gone") {
        job.sessionId = null;
        job.confirmed = 0;
      } else if (st) {
        job.confirmed = st.offset;
        if (st.done) return complete(job);
      }
    }
    while (!job.sessionId) {
      if (job.canceled) return;
      try {
        const id = await openSession(job);
        if (job.canceled) {
          // Annulé pendant l'ouverture : personne d'autre ne connaît cet id.
          await deleteSession(id);
          return;
        }
        job.sessionId = id;
        job.confirmed = 0;
      } catch (err) {
        if (err instanceof TerminalError) throw err;
        markRetrying(job, "Serveur injoignable — nouvel essai…");
        await sleep(job, backoff(attempt++));
      }
    }
    job.state = "uploading";
    job.message = undefined;
    emit(true);

    for (;;) {
      if (job.canceled) return;
      const offset = job.confirmed;
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, job.file.size);
      const r = await sendChunk(job, offset, end);
      if (job.canceled) return;

      if (r.kind === "ok") {
        job.confirmed = r.status.offset;
        attempt = 0;
        stuck = 0;
        if (job.state !== "uploading") {
          job.state = "uploading";
          job.message = undefined;
          emit(true);
        }
        if (r.status.done) return complete(job);
        continue;
      }
      // NB : un « aborted » ici ne vient PAS d'une annulation (déjà traitée
      // ci-dessus) mais du navigateur (navigation vers un téléchargement sous
      // Firefox, touche Échap…) → réessayable comme une coupure réseau.
      if (r.kind === "http") {
        if (r.res.status === 410) {
          throw new TerminalError("Envoi annulé côté serveur.");
        }
        if (TERMINAL_STATUSES.has(r.res.status)) {
          throw new TerminalError(await terminalMessage(r.res));
        }
        if (r.res.status === 409 && r.offset !== null) {
          // Position désynchronisée : le serveur donne la bonne.
          job.confirmed = r.offset;
          continue;
        }
      }

      // Échec réessayable : attendre, vérifier la source, relire l'état.
      for (;;) {
        markRetrying(job, "Connexion perdue — reprise automatique…");
        await sleep(job, backoff(attempt++));
        if (job.canceled) return;
        await assertReadable(job, job.confirmed);
        const st = await probe(job);
        if (!st) continue; // toujours injoignable
        if (st.done) return complete(job);
        if (st.busy) continue; // l'ancien morceau finit côté serveur
        // Le serveur répond mais le morceau n'avance plus : au-delà d'un
        // certain nombre d'échecs d'affilée, ce n'est plus une coupure réseau
        // passagère → on s'arrête et on le dit (« Réessayer » repart d'ici).
        stuck = st.offset > job.confirmed ? 0 : stuck + 1;
        if (stuck >= MAX_STUCK_RETRIES) {
          throw new TerminalError(
            "L'envoi échoue alors que le serveur répond. Réessaie ; si ça persiste, recharge la page et relance l'envoi.",
          );
        }
        job.confirmed = st.offset;
        break;
      }
    }
  } catch (err) {
    if (job.canceled) return;
    job.state = "error";
    job.message =
      err instanceof TerminalError ? err.message : "Échec inattendu de l'envoi.";
    job.samples = [];
    emit(true);
  } finally {
    job.xhr = null;
    job.inFlight = 0;
    if (!job.canceled) pump();
  }
}

function complete(job: Job): void {
  job.state = "done";
  job.confirmed = job.file.size;
  job.message = undefined;
  job.samples = [];
  // Écouteurs AVANT la publication : ils savent qu'un envoi a abouti au
  // moment où l'UI voit la file se vider.
  for (const l of completedListeners) l();
  emit(true);
}

// ─── Garde-fous de page (actifs seulement pendant un envoi) ─────────────────

let guarded = false;
let wakeSentinel: WakeLockSentinel | null = null;

/** Le navigateur affiche SON propre texte (« Quitter le site ? … ») : on ne
 * peut pas le personnaliser — le bandeau de l'UI porte le message explicite. */
function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = "";
}

/** Session serveur encore ouverte (envoi actif OU en erreur, que « Réessayer »
 * pourrait reprendre) : sans reprise après rechargement, elle ne sert plus à
 * rien dès que la page part. */
function hasOpenSession(job: Job): boolean {
  return job.sessionId !== null && job.state !== "done";
}

/** La page part pour de bon (fermeture confirmée, rechargement) : on libère
 * tout de suite les partiels côté serveur (sinon ils occupent le disque
 * jusqu'à la purge). `keepalive` laisse la requête survivre au déchargement. */
function onPageHide(): void {
  for (const job of jobs) {
    if (hasOpenSession(job)) {
      void fetch(`/api/upload/sessions/${job.sessionId}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    }
  }
}

/** Wake Lock écran : un portable qui se met en veille coupe un envoi de
 * plusieurs heures. Relâché par le navigateur quand l'onglet passe en arrière-
 * plan → ré-acquis au retour. Best-effort (API absente / refusée). */
async function acquireWakeLock(): Promise<void> {
  if (!("wakeLock" in navigator) || wakeSentinel) return;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      if (wakeSentinel === sentinel) wakeSentinel = null;
    });
    if (guarded) wakeSentinel = sentinel;
    else void sentinel.release().catch(() => {});
  } catch {
    // Refusé (onglet caché, économie d'énergie…) : best-effort.
  }
}

function onVisibility(): void {
  if (document.visibilityState === "visible" && guarded) void acquireWakeLock();
}

/** Réveille les envois en attente de réessai dès que le réseau revient. */
function onOnline(): void {
  for (const job of jobs) job.wake?.();
}

let cleanupOnHide = false;

function updateGuards(): void {
  if (typeof window === "undefined") return;
  const active = hasActiveUploads();
  if (active && !guarded) {
    guarded = true;
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    void acquireWakeLock();
  } else if (!active && guarded) {
    guarded = false;
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    void wakeSentinel?.release().catch(() => {});
    wakeSentinel = null;
  }
  // Nettoyage au départ de la page : aussi pour un envoi EN ERREUR (sa
  // session est gardée pour « Réessayer »), pas seulement pour les actifs.
  const open = jobs.some(hasOpenSession);
  if (open !== cleanupOnHide) {
    cleanupOnHide = open;
    if (open) window.addEventListener("pagehide", onPageHide);
    else window.removeEventListener("pagehide", onPageHide);
  }
}
