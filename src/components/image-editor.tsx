"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";
import { AdjustFilter } from "@/components/adjust-filter";
import {
  applyAdjust,
  isAdjusted,
  SLIDERS,
  ZERO_ADJUST,
  type Adjust,
} from "@/lib/image-adjust";
import {
  openProjectionChannel,
  type ProjectionMessage,
} from "@/lib/projection-channel";

type EditorFile = {
  id: string;
  original_name: string;
  mime: string | null;
  folder_id: string | null;
};
type Folder = { id: string; name: string };

/** Limite de taille canvas du navigateur (au-delà, le dessin échoue en silence). */
const MAX_DIM = 16384;

/** Nom sans extension. */
function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
/** Remplace l'extension du nom par `ext`. */
function withExt(name: string, ext: string): string {
  return `${baseName(name)}.${ext}`;
}

/** Format d'écrasement : on conserve le type de l'original (sinon JPEG). */
function overwriteMime(file: EditorFile): string {
  const name = file.original_name.toLowerCase();
  if (file.mime === "image/png" || name.endsWith(".png")) return "image/png";
  if (file.mime === "image/webp" || name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Rend l'image retouchée dans un blob — boucle pixel `<canvas>` avec EXACTEMENT
 * la même math que le filtre SVG de l'aperçu (cf. `applyAdjust`), PAS `ctx.filter`
 * (mal géré par Safari). `bust` force le rechargement des octets COURANTS (utile
 * pour un 2e écrasement de suite : l'aperçu inline est caché ~5 min).
 */
async function renderAdjusted(
  fileId: string,
  adjust: Adjust,
  outMime: string,
  quality: number | undefined,
  bust: number,
): Promise<Blob> {
  // Charge l'image à sa résolution native (même origine → canvas non « tainted »).
  const img = new Image();
  img.src = `/api/files/${fileId}?inline=1&_=${bust}`;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Chargement de l'image trop long.")),
      30000,
    );
    img.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Image illisible."));
    };
  });

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("Image illisible.");
  // Au-delà de la limite canvas du navigateur, le dessin échoue en silence
  // (canvas « neutered ») → on refuse plutôt que d'écrire une image vide.
  if (w > MAX_DIM || h > MAX_DIM) {
    throw new Error(
      `Image trop grande (${w}×${h} px). Maximum ${MAX_DIM} px par côté.`,
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");
  // JPEG ne gère pas la transparence → fond blanc déterministe.
  if (outMime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  applyAdjust(imageData.data, adjust);
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, quality),
  );
  if (!blob) throw new Error("Échec de l'encodage.");
  return blob;
}

/**
 * Éditeur d'image admin : réglages non-destructifs (aperçu live). Deux sorties :
 * - « Enregistrer une copie » : exporte une COPIE retouchée (nouveau fichier) —
 *   l'original reste intact.
 * - « Écraser l'original » : remplace DÉFINITIVEMENT le fichier d'origine (avec
 *   confirmation). Destructif et irréversible.
 *
 * En mode présentateur (`live`), le réglage est diffusé en temps réel à la
 * fenêtre publique (le projecteur) via `BroadcastChannel`.
 */
export function ImageEditor({
  file,
  folders,
  live = false,
  bustValue,
  onDone,
  onSaved,
}: {
  file: EditorFile;
  folders: Folder[];
  /** Diffuse le réglage en direct à la fenêtre publique (mode présentateur). */
  live?: boolean;
  /** Jeton de cache-bust (si l'image a déjà été écrasée) pour l'aperçu. */
  bustValue?: number;
  onDone: () => void;
  /** Appelé après un enregistrement réussi (copie : nouvel id ; écrasement : même id). */
  onSaved: (id: string) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [adjust, setAdjust] = useState<Adjust>(ZERO_ADJUST);
  const [showSave, setShowSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Id de filtre unique par instance ; les « : » de useId sont retirés car
  // invalides dans une référence CSS url(#…).
  const filterId = `adjust-${useId().replace(/:/g, "")}`;

  const dirty = isAdjusted(adjust);
  // Aperçu : cache-bust si l'image vient d'être écrasée (l'URL inline est cachée
  // ~5 min) → on ne montre pas une version périmée après un écrasement.
  const src =
    bustValue != null
      ? `/api/files/${file.id}?inline=1&v=${bustValue}`
      : `/api/files/${file.id}?inline=1`;

  // Garde les setState d'un écrasement en vol (l'éditeur peut être fermé pendant).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // — Diffusion LIVE du réglage vers la fenêtre publique (mode présentateur) —
  // Canal persistant (créé une fois) pour ne pas le rouvrir à chaque slider, et
  // pour ne pas « clignoter » (un open/close par changement reposterait null).
  const liveChanRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!live) return;
    const chan = openProjectionChannel();
    liveChanRef.current = chan;
    return () => {
      // Quitter l'éditeur retire le filtre du projecteur. On ferme le canal au
      // PROCHAIN tick : un close() juste après postMessage peut perdre le message
      // (sinon le filtre resterait collé sur le projecteur).
      try {
        chan?.postMessage({
          type: "adjust",
          id: file.id,
          adjust: null,
        } satisfies ProjectionMessage);
      } catch {
        /* canal déjà fermé */
      }
      setTimeout(() => chan?.close(), 0);
      liveChanRef.current = null;
    };
  }, [live, file.id]);
  useEffect(() => {
    if (!live) return;
    liveChanRef.current?.postMessage({
      type: "adjust",
      id: file.id,
      adjust,
    } satisfies ProjectionMessage);
  }, [live, adjust, file.id]);

  async function overwrite() {
    const ok = await confirm({
      title: "Écraser l'image originale ?",
      message:
        "Les réglages remplaceront définitivement le fichier d'origine. Cette action est irréversible.",
      confirmLabel: "Écraser",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const outMime = overwriteMime(file);
      const bust = Date.now();
      const blob = await renderAdjusted(
        file.id,
        adjust,
        outMime,
        outMime === "image/jpeg" ? 0.92 : undefined,
        bust,
      );
      const res = await fetch(`/api/files/${file.id}`, {
        method: "PUT",
        headers: { "content-type": outMime },
        body: blob,
      });
      if (!res.ok) {
        let msg = "Échec de l'écrasement.";
        try {
          msg = (await res.json()).error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      // Octets remplacés → demande aux fenêtres de projection de recharger (les
      // blobs préchargés sont figés) et retire le filtre live. On réutilise le
      // canal LIVE persistant (présentateur) : il reste ouvert → pas de course au
      // close. Hors présentateur, aucune fenêtre n'écoute (l'explorateur se
      // rafraîchit via `bustValue`), donc rien à diffuser.
      liveChanRef.current?.postMessage({
        type: "reload",
        id: file.id,
        v: bust,
      } satisfies ProjectionMessage);
      liveChanRef.current?.postMessage({
        type: "adjust",
        id: file.id,
        adjust: null,
      } satisfies ProjectionMessage);
      router.refresh();
      onSaved(file.id);
    } catch (e) {
      if (aliveRef.current) {
        setError(e instanceof Error ? e.message : "Échec de l'écrasement.");
      }
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AdjustFilter a={adjust} id={filterId} />

      <div className="flex min-h-[20rem] items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={file.original_name}
          style={{ filter: `url(#${filterId})` }}
          className="max-h-[70vh] w-auto max-w-full rounded object-contain"
        />
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {SLIDERS.map((s) => (
          <label key={s.key} className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-xs text-zinc-400">
              <span>{s.label}</span>
              <span className="tabular-nums text-zinc-500">
                {adjust[s.key] > 0 ? `+${adjust[s.key]}` : adjust[s.key]}
              </span>
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              value={adjust[s.key]}
              onChange={(e) =>
                setAdjust((a) => ({ ...a, [s.key]: Number(e.target.value) }))
              }
              className="w-full accent-zinc-300"
            />
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowSave(true)}
          disabled={busy}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
        >
          Enregistrer une copie…
        </button>
        <button
          type="button"
          onClick={overwrite}
          disabled={busy || !dirty}
          title={!dirty ? "Modifie d'abord un réglage" : undefined}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:border-red-900 hover:bg-zinc-900 hover:text-red-300 disabled:opacity-40"
        >
          {busy ? "Écrasement…" : "Écraser l'original"}
        </button>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => setAdjust(ZERO_ADJUST)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-40"
        >
          Réinitialiser
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 disabled:opacity-50"
        >
          Fermer l&apos;éditeur
        </button>
      </div>

      {showSave && (
        <SaveDialog
          file={file}
          folders={folders}
          adjust={adjust}
          onCancel={() => setShowSave(false)}
          onSaved={(id) => {
            setShowSave(false);
            router.refresh();
            onSaved(id);
          }}
        />
      )}
    </div>
  );
}

/** Modale « Enregistrer une copie » : nom, dossier, format (PNG/JPEG), qualité. */
function SaveDialog({
  file,
  folders,
  adjust,
  onCancel,
  onSaved,
}: {
  file: EditorFile;
  folders: Folder[];
  adjust: Adjust;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  // Format par défaut selon l'image d'entrée (PNG si source PNG, sinon JPEG).
  const inputIsPng =
    file.mime === "image/png" ||
    file.original_name.toLowerCase().endsWith(".png");
  const [format, setFormat] = useState<"png" | "jpg">(
    inputIsPng ? "png" : "jpg",
  );
  const [name, setName] = useState(
    `${baseName(file.original_name)} (retouché).${inputIsPng ? "png" : "jpg"}`,
  );
  const [quality, setQuality] = useState(92);
  const [folderId, setFolderId] = useState<string | null>(file.folder_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Composant encore monté ? Garde les setState d'un export en vol (l'utilisateur
  // peut fermer l'éditeur pendant l'enregistrement) de viser un composant démonté.
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  // Échap ferme la modale (sauf pendant l'enregistrement), comme les autres modales.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  function changeFormat(next: "png" | "jpg") {
    setFormat(next);
    setName((n) => withExt(n, next));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const blob = await renderAdjusted(
        file.id,
        adjust,
        mime,
        format === "jpg" ? quality / 100 : undefined,
        Date.now(),
      );

      // Upload comme NOUVEAU fichier (l'original reste intact).
      const finalName = withExt(name.trim() || "image", format);
      const headers: Record<string, string> = {
        "x-filename": encodeURIComponent(finalName),
        "content-type": mime,
      };
      if (folderId) headers["x-folder"] = folderId;
      const res = await fetch("/api/upload", {
        method: "POST",
        headers,
        body: blob,
      });
      if (res.status !== 201) {
        let msg = "Échec de l'enregistrement.";
        try {
          msg = (await res.json()).error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      const { id } = (await res.json()) as { id: string };
      onSaved(id);
    } catch (e) {
      if (aliveRef.current) {
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
      }
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enregistrer l'image retouchée"
    >
      <button
        type="button"
        aria-label="Fermer"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">
          Enregistrer une copie…
        </h2>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Nom du fichier</span>
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
        </label>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Dossier</span>
          <select
            value={folderId ?? "__root__"}
            onChange={(e) =>
              setFolderId(e.target.value === "__root__" ? null : e.target.value)
            }
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          >
            <option value="__root__">Aucun dossier (racine)</option>
            {folders.map((fo) => (
              <option key={fo.id} value={fo.id}>
                {fo.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Format</span>
          <div className="flex gap-2">
            {(["jpg", "png"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => changeFormat(opt)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  format === opt
                    ? "border-zinc-400 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                {opt === "jpg" ? "JPEG" : "PNG"}
              </button>
            ))}
          </div>
        </div>

        {format === "jpg" && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="flex items-center justify-between text-xs text-zinc-400">
              <span>Qualité JPEG</span>
              <span className="tabular-nums text-zinc-500">{quality}</span>
            </span>
            <input
              type="range"
              min={50}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-zinc-300"
            />
          </label>
        )}

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
