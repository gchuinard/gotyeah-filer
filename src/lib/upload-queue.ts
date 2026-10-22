/* File d'envoi PAR MORCEAUX, côté navigateur (protocole :
 * `src/lib/upload-protocol.ts`, serveur : `app/api/upload/sessions/*`).
 *
 * Module JS hors React (lu par `useSyncExternalStore`) : la file vit tant que
 * l'onglet vit, même quand `UploadZone` est démontée (vue « Accueil ») — un
 * envoi de 48 Go dure des heures, on ne le perd pas pour un changement de vue.
 * Pas de reprise après rechargement (décision produit) : à la place, un
 * avertissement avant de quitter la page tant qu'un envoi tourne.
 *
 * Mode PARALLÈLE : chaque fichier a plusieurs morceaux numérotés en vol
 * (`UPLOAD_PARALLEL_CHUNKS` « voies »), que le serveur écrit à leur place.
 * Derrière Cloudflare (qui reçoit chaque morceau en entier avant de le
 * transmettre), c'est ce qui recouvre les attentes au lieu de les additionner.
 *
 * Robustesse : ce que le serveur a reçu fait foi. Après tout échec (réseau,
 * 5xx, 408, chien de garde), le morceau repart en tête de file ; la voie
 * attend (backoff plafonné à 30 s, réveil anticipé sur `online`), vérifie que
 * le fichier source est encore lisible et sonde le serveur avant de repartir.
 * Les réessais sont sans fin ; seuls 400/403/404/410/413/507 (ou un fichier
 * illisible) arrêtent l'envoi. */

import { apiErrorMessage } from "@/lib/api-error";
import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_CHUNK_HEADER,
  UPLOAD_PARALLEL_CHUNKS,
  chunkCount,
  chunkLength,
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

/** Morceaux en vol au total, tous fichiers confondus : 2 gros fichiers × 4
 * voies, ou davantage de petits fichiers (une voie chacun) — sinon un lot de
 * photos ne garderait que 2 requêtes en vol. */
const MAX_IN_FLIGHT = 2 * UPLOAD_PARALLEL_CHUNKS;
/** Fichiers ouverts en même temps, au plus. */
const MAX_FILES = 6;
/** Aucune progression pendant ce délai → on abandonne le morceau et on sonde. */
const STALL_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
/** Échecs d'affilée tolérés (par voie) quand le serveur répond mais que les
 * morceaux ne passent pas (~6 min avec le backoff plafonné) avant l'erreur. */
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
  /** Taille des morceaux, donnée par le serveur à l'ouverture. */
  chunkSize: number;
  /** Morceaux restant à envoyer (un morceau en échec y revient en tête). */
  pending: number[];
  /** Morceaux confirmés par le serveur. */
  doneChunks: Set<number>;
  /** Octets confirmés (somme des morceaux confirmés). */
  confirmed: number;
  /** Progression des morceaux en vol (octets partis, par numéro). */
  inFlight: Map<number, number>;
  state: UploadState;
  message?: string;
  canceled: boolean;
  xhrs: Set<XMLHttpRequest>;
  /** Attentes de backoff en cours (une par voie) : annulation, retour réseau. */
  wakers: Set<() => void>;
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

function inFlightBytes(job: Job): number {
  let total = 0;
  for (const n of job.inFlight.values()) total += n;
  return total;
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
    sent: Math.min(j.file.size, j.confirmed + inFlightBytes(j)),
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
  const bytes = job.confirmed + inFlightBytes(job);
  // Un morceau en échec sort du compte (ses octets seront renvoyés) : on
  // repart d'une fenêtre neuve plutôt qu'afficher un débit négatif.
  const last = job.samples[job.samples.length - 1];
  if (last && bytes < last.bytes) job.samples = [];
  job.samples.push({ t: now, bytes });
  while (job.samples.length > 2 && now - job.samples[0].t > SPEED_WINDOW_MS) {
    job.samples.shift();
  }
}

function abortAll(job: Job): void {
  for (const xhr of job.xhrs) xhr.abort();
  for (const wake of job.wakers) wake();
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
    // Un ancien essai en erreur du même fichier : le nouvel envoi le remplace
    // (le serveur jette déjà sa session par empreinte) — sinon son « Réessayer »
    // rouvrirait une session qui jetterait à son tour celle du nouvel envoi.
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].fingerprint === fingerprint && jobs[i].state === "error") {
        jobs.splice(i, 1);
      }
    }
    jobs.push({
      key: crypto.randomUUID(),
      file,
      folderId,
      fingerprint,
      sessionId: null,
      chunkSize: UPLOAD_CHUNK_BYTES,
      pending: [],
      doneChunks: new Set(),
      confirmed: 0,
      inFlight: new Map(),
      state: "queued",
      canceled: false,
      xhrs: new Set(),
      wakers: new Set(),
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
  abortAll(job);
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
    abortAll(job);
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

/** Relance un envoi en erreur (repart des morceaux déjà reçus par le serveur si
 * la session existe encore, sinon de zéro). */
export function retryUpload(key: string): void {
  const job = jobs.find((j) => j.key === key);
  if (!job || job.state !== "error") return;
  // Même fichier déjà relancé (ou envoyé) entre-temps : on ne le rouvre pas.
  if (jobs.some((j) => j !== job && j.fingerprint === job.fingerprint)) {
    jobs.splice(jobs.indexOf(job), 1);
    emit(true);
    return;
  }
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

/** Voies qu'un fichier occupera (une par morceau, `UPLOAD_PARALLEL_CHUNKS` au plus). */
function lanesFor(job: Job): number {
  return Math.max(
    1,
    Math.min(UPLOAD_PARALLEL_CHUNKS, chunkCount(job.file.size, job.chunkSize)),
  );
}

function pump(): void {
  const running = jobs.filter(
    (j) => j.state === "uploading" || j.state === "retrying",
  );
  let files = running.length;
  let lanes = running.reduce((n, j) => n + lanesFor(j), 0);
  for (const job of jobs) {
    if (job.state !== "queued") continue;
    // Dans l'ordre de la file : un gros fichier qui ne tient pas encore
    // attend, les suivants aussi (pas de dépassement par les petits).
    if (files >= MAX_FILES || (files > 0 && lanes + lanesFor(job) > MAX_IN_FLIGHT)) {
      break;
    }
    files += 1;
    lanes += lanesFor(job);
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
      job.wakers.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    job.wakers.add(done);
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
  | { kind: "http"; res: Response }
  | { kind: "network" }
  | { kind: "aborted" };

/** Envoie le morceau `index` par XHR (progression + abort), sous chien de garde. */
function sendChunk(job: Job, index: number): Promise<ChunkResult> {
  return new Promise((resolve) => {
    const start = index * job.chunkSize;
    const end = Math.min(start + job.chunkSize, job.file.size);
    const xhr = new XMLHttpRequest();
    job.xhrs.add(xhr);
    let lastActivity = Date.now();
    // Avant le premier octet, la requête peut attendre une connexion libre
    // (HTTP/1.1 : 6 par hôte, moins que 2 fichiers × 4 voies) : délai doublé.
    let started = false;
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > (started ? STALL_MS : 2 * STALL_MS)) {
        stalled = true;
        xhr.abort();
      }
    }, 5000);
    const finish = (r: ChunkResult) => {
      clearInterval(watchdog);
      job.xhrs.delete(xhr);
      job.inFlight.delete(index);
      resolve(r);
    };

    xhr.open("PUT", `/api/upload/sessions/${job.sessionId}`);
    xhr.setRequestHeader(UPLOAD_CHUNK_HEADER, String(index));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      lastActivity = Date.now();
      if (e.loaded > 0) started = true;
      job.inFlight.set(index, e.loaded);
      recordProgress(job);
      emit();
    };
    // Corps parti : on laisse encore STALL_MS au serveur pour répondre.
    xhr.upload.onload = () => {
      lastActivity = Date.now();
      started = true;
    };
    xhr.onload = () => {
      let body: UploadStatus | null = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadStatus;
      } catch {
        body = null;
      }
      if (xhr.status === 200 && body && typeof body.done === "boolean") {
        finish({ kind: "ok", status: body });
      } else {
        finish({ kind: "http", res: xhrToResponse(xhr) });
      }
    };
    xhr.onerror = () => finish({ kind: "network" });
    xhr.onabort = () => finish(stalled ? { kind: "network" } : { kind: "aborted" });
    xhr.send(job.file.slice(start, end));
  });
}

async function openSession(job: Job): Promise<UploadInitResponse> {
  const res = await fetch("/api/upload/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: job.file.name,
      size: job.file.size,
      mime: job.file.type || "application/octet-stream",
      folderId: job.folderId,
      lastModified: job.file.lastModified,
      parallel: true,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 201) {
    const init = (await res.json()) as UploadInitResponse;
    if (!init.parallel) {
      // Serveur pas encore à jour (onglet plus récent que le déploiement) : il
      // vient d'ouvrir une session séquentielle, qui réserverait la place du
      // fichier pendant 6 h si on ne la refermait pas.
      await deleteSession(init.id);
      throw new TerminalError("Serveur pas à jour : recharge la page et relance l'envoi.");
    }
    return init;
  }
  if (TERMINAL_STATUSES.has(res.status)) {
    throw new TerminalError(await terminalMessage(res));
  }
  throw new Error(`HTTP ${res.status}`); // réessayable
}

/** Relit l'état serveur (avec la liste des morceaux reçus si `detail`).
 * null = serveur injoignable. */
async function probe(job: Job, detail = false): Promise<UploadStatus | null> {
  try {
    const res = await fetch(
      `/api/upload/sessions/${job.sessionId}${detail ? "?detail=1" : ""}`,
      { cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (res.ok) {
      const st = (await res.json()) as UploadStatus;
      // Pas de `received` : serveur revenu à une version séquentielle
      // (retour arrière) — rien ne passera, autant le dire tout de suite.
      if (!st.done && typeof st.received !== "number") {
        throw new TerminalError("Serveur pas à jour : recharge la page et relance l'envoi.");
      }
      return st;
    }
    if (TERMINAL_STATUSES.has(res.status)) {
      throw new TerminalError(await terminalMessage(res));
    }
    return null;
  } catch (err) {
    if (err instanceof TerminalError) throw err;
    return null;
  }
}

/** Le morceau `index` du fichier source est-il encore lisible (disque
 * débranché, fichier modifié ou déplacé depuis sa sélection → NotReadableError) ?
 * On lit le morceau ENTIER : une erreur de lecture plus loin dans la tranche
 * ferait sinon échouer chaque PUT comme une simple coupure réseau. */
async function assertReadable(job: Job, index: number): Promise<void> {
  const start = index * job.chunkSize;
  if (start >= job.file.size) return;
  try {
    await job.file
      .slice(start, Math.min(start + job.chunkSize, job.file.size))
      .arrayBuffer();
  } catch {
    throw new TerminalError(
      "Le fichier source n'est plus lisible (déplacé, modifié ou disque débranché).",
    );
  }
}

/** Repart des morceaux que le serveur a déjà (après une erreur, un « Réessayer »). */
function resyncFrom(job: Job, received: number[]): void {
  const total = chunkCount(job.file.size, job.chunkSize);
  job.doneChunks = new Set(received.filter((i) => i >= 0 && i < total));
  job.confirmed = 0;
  for (const i of job.doneChunks) {
    job.confirmed += chunkLength(i, job.file.size, job.chunkSize);
  }
  job.pending = [];
  for (let i = 0; i < total; i++) if (!job.doneChunks.has(i)) job.pending.push(i);
  // Tout est reçu mais rien n'est finalisé (finalisation en échec, disque
  // plein…) : seul un PUT finalise → on renvoie le dernier morceau (idempotent).
  if (job.pending.length === 0 && total > 0) job.pending.push(total - 1);
}

/** État partagé par les voies d'un même fichier. */
type JobRun = {
  attempt: number;
  stuck: number;
  /** Voies en attente de réessai. */
  retrying: number;
  /** Voies encore en cours : « reconnexion » seulement si TOUTES attendent
   * (sinon d'autres voies avancent, l'envoi n'est pas bloqué). */
  active: number;
  done: boolean;
  terminal: TerminalError | null;
};

/** Erreur terminale : on la note (la première gagne) et on arrête TOUTES les
 * voies tout de suite — sinon l'erreur n'apparaîtrait qu'après le morceau en
 * vol le plus lent, envoyé pour rien. */
function stop(job: Job, run: JobRun, err: TerminalError): void {
  run.terminal ??= err;
  abortAll(job);
}

function setRetrying(job: Job, run: JobRun, delta: number): void {
  run.retrying += delta;
  const stalled = run.retrying > 0 && run.retrying >= run.active;
  if (stalled && job.state !== "retrying") {
    job.state = "retrying";
    job.message = "Connexion perdue — reprise automatique…";
    job.samples = [];
    emit(true);
  } else if (!stalled && job.state === "retrying") {
    job.state = "uploading";
    job.message = undefined;
    emit(true);
  }
}

/**
 * Une VOIE d'envoi : prend le prochain morceau de la file, l'envoie, recommence.
 * Plusieurs voies tournent en même temps sur un fichier. Un morceau en échec
 * revient en tête de file (une autre voie peut le reprendre) et la voie attend
 * (backoff), vérifie la source et sonde le serveur avant de repartir.
 */
async function lane(job: Job, run: JobRun): Promise<void> {
  for (;;) {
    if (job.canceled || run.done || run.terminal) return;
    const index = job.pending.shift();
    if (index === undefined) return;
    const r = await sendChunk(job, index);
    if (job.canceled || run.done || run.terminal) return;

    if (r.kind === "ok") {
      if (!job.doneChunks.has(index)) {
        job.doneChunks.add(index);
        job.confirmed += chunkLength(index, job.file.size, job.chunkSize);
      }
      run.attempt = 0;
      run.stuck = 0;
      if (r.status.done) {
        run.done = true;
        abortAll(job); // les autres voies n'ont plus rien d'utile en vol
        return;
      }
      continue;
    }
    // NB : un « aborted » ici ne vient PAS d'une annulation (déjà traitée
    // ci-dessus) mais du navigateur (navigation vers un téléchargement sous
    // Firefox, touche Échap…) → réessayable comme une coupure réseau.
    if (r.kind === "http") {
      if (r.res.status === 410) {
        stop(job, run, new TerminalError("Envoi annulé côté serveur."));
        return;
      }
      if (TERMINAL_STATUSES.has(r.res.status)) {
        stop(job, run, new TerminalError(await terminalMessage(r.res)));
        return;
      }
    }

    // Échec réessayable : le morceau repart en tête de file, la voie attend.
    job.pending.unshift(index);
    setRetrying(job, run, +1);
    try {
      for (;;) {
        await sleep(job, backoff(run.attempt++));
        if (job.canceled || run.done || run.terminal) return;
        await assertReadable(job, index);
        const st = await probe(job);
        if (!st) continue; // toujours injoignable
        if (st.done) {
          run.done = true;
          abortAll(job);
          return;
        }
        // Le serveur répond mais les morceaux ne passent plus : au-delà d'un
        // certain nombre d'échecs d'affilée, ce n'est plus une coupure réseau
        // passagère → on s'arrête et on le dit (« Réessayer » repart d'ici).
        // Seuil partagé par les voies encore actives (~12 échecs chacune).
        run.stuck += 1;
        if (run.stuck >= MAX_STUCK_RETRIES * Math.max(1, run.active)) {
          stop(
            job,
            run,
            new TerminalError(
              "L'envoi échoue alors que le serveur répond. Réessaie ; si ça persiste, recharge la page et relance l'envoi.",
            ),
          );
          return;
        }
        break;
      }
    } catch (err) {
      if (err instanceof TerminalError) {
        stop(job, run, err);
        return;
      }
      throw err;
    } finally {
      setRetrying(job, run, -1);
    }
  }
}

async function runJob(job: Job): Promise<void> {
  let attempt = 0;
  try {
    // Nouvel essai après erreur : on repart des morceaux que le serveur a
    // déjà, si la session existe encore.
    if (job.sessionId) {
      const st = await probe(job, true).catch((err) => {
        if (err instanceof TerminalError) return "gone" as const;
        throw err;
      });
      if (st === "gone") {
        job.sessionId = null;
      } else if (st?.done) {
        return complete(job);
      } else if (st?.receivedChunks) {
        resyncFrom(job, st.receivedChunks);
      }
    }
    while (!job.sessionId) {
      if (job.canceled) return;
      try {
        const init = await openSession(job);
        if (job.canceled) {
          // Annulé pendant l'ouverture : personne d'autre ne connaît cet id.
          await deleteSession(init.id);
          return;
        }
        job.sessionId = init.id;
        job.chunkSize = init.chunkSize;
        resyncFrom(job, []);
      } catch (err) {
        if (err instanceof TerminalError) throw err;
        job.state = "retrying";
        job.message = "Serveur injoignable — nouvel essai…";
        emit(true);
        await sleep(job, backoff(attempt++));
      }
    }
    job.state = "uploading";
    job.message = undefined;
    emit(true);

    const lanes = Math.max(1, Math.min(UPLOAD_PARALLEL_CHUNKS, job.pending.length));
    const run: JobRun = {
      attempt: 0,
      stuck: 0,
      retrying: 0,
      active: lanes,
      done: false,
      terminal: null,
    };
    await Promise.all(
      Array.from({ length: lanes }, () =>
        lane(job, run).finally(() => {
          run.active -= 1;
          if (!job.canceled) setRetrying(job, run, 0); // réévalue l'état
        }),
      ),
    );
    if (job.canceled) return;
    if (run.terminal) throw run.terminal;
    if (run.done) return complete(job);

    // Toutes les voies ont fini sans « terminé » (cas limite) : on sonde, puis
    // on renvoie ce qui manque — ou le dernier morceau si tout est reçu mais
    // pas finalisé (cf. resyncFrom).
    for (;;) {
      const st = await probe(job, true);
      if (st?.done) return complete(job);
      if (st?.receivedChunks) {
        resyncFrom(job, st.receivedChunks);
        job.state = "queued";
        return;
      }
      if (job.canceled) return;
      await sleep(job, backoff(attempt++));
    }
  } catch (err) {
    if (job.canceled) return;
    job.state = "error";
    job.message =
      err instanceof TerminalError ? err.message : "Échec inattendu de l'envoi.";
    job.samples = [];
    emit(true);
  } finally {
    job.inFlight.clear();
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
  for (const job of jobs) for (const wake of [...job.wakers]) wake();
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
