"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Réglages de retouche (chaque valeur ∈ [-100, 100], 0 = inchangé). */
export type Adjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  red: number;
  green: number;
  blue: number;
};

const ZERO: Adjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  red: 0,
  green: 0,
  blue: 0,
};

const SLIDERS: { key: keyof Adjust; label: string }[] = [
  { key: "brightness", label: "Luminosité" },
  { key: "contrast", label: "Contraste" },
  { key: "saturation", label: "Saturation" },
  { key: "red", label: "Rouge" },
  { key: "green", label: "Vert" },
  { key: "blue", label: "Bleu" },
];

type EditorFile = {
  id: string;
  original_name: string;
  mime: string | null;
  folder_id: string | null;
};
type Folder = { id: string; name: string };

const f = (v: number) => 1 + v / 100;

/**
 * Filtre SVG inline pour l'APERÇU live (appliqué à l'<img> via `filter: url()`).
 * `color-interpolation-filters="sRGB"` est essentiel : sans lui le filtre opère
 * en linearRGB et le rendu ne correspondrait plus à l'export (boucle pixel sRGB).
 * Saturation via feColorMatrix, puis contraste + luminosité + gain par canal
 * repliés dans une transformation linéaire par canal (feComponentTransfer).
 */
function AdjustFilter({ a, id }: { a: Adjust; id: string }) {
  const B = f(a.brightness);
  const C = f(a.contrast);
  const lin = (gain: number) => {
    const g = f(gain);
    return { slope: g * B * C, intercept: g * B * 0.5 * (1 - C) };
  };
  const r = lin(a.red);
  const g = lin(a.green);
  const b = lin(a.blue);
  return (
    <svg aria-hidden className="absolute h-0 w-0">
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values={String(f(a.saturation))} />
        <feComponentTransfer>
          <feFuncR type="linear" slope={r.slope} intercept={r.intercept} />
          <feFuncG type="linear" slope={g.slope} intercept={g.intercept} />
          <feFuncB type="linear" slope={b.slope} intercept={b.intercept} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

/**
 * Applique les mêmes réglages que le filtre SVG, mais sur les pixels bruts pour
 * l'EXPORT (déterministe, sans dépendre de `ctx.filter` que Safari gère mal).
 * `data` est un Uint8ClampedArray : l'affectation clampe et arrondit toute seule.
 */
function applyAdjust(data: Uint8ClampedArray, a: Adjust): void {
  const S = f(a.saturation);
  const B = f(a.brightness);
  const C = f(a.contrast);

  // Matrice de saturation : mêmes coefficients que SVG feColorMatrix type="saturate".
  const m00 = 0.213 + 0.787 * S,
    m01 = 0.715 - 0.715 * S,
    m02 = 0.072 - 0.072 * S;
  const m10 = 0.213 - 0.213 * S,
    m11 = 0.715 + 0.285 * S,
    m12 = 0.072 - 0.072 * S;
  const m20 = 0.213 - 0.213 * S,
    m21 = 0.715 - 0.715 * S,
    m22 = 0.072 + 0.928 * S;

  // Linéaire par canal (contraste + luminosité + gain), en espace [0,255].
  const gr = f(a.red),
    gg = f(a.green),
    gb = f(a.blue);
  const sr = gr * B * C,
    ir = gr * B * 127.5 * (1 - C);
  const sg = gg * B * C,
    ig = gg * B * 127.5 * (1 - C);
  const sb = gb * B * C,
    ib = gb * B * 127.5 * (1 - C);

  // Clampe la sortie de saturation à [0,255] avant le transfer linéaire : le SVG
  // clampe feColorMatrix avant feComponentTransfer ; on reproduit ce palier pour
  // que l'aperçu et l'export coïncident, même en réglages extrêmes.
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const cr = clamp(m00 * r + m01 * g + m02 * b);
    const cg = clamp(m10 * r + m11 * g + m12 * b);
    const cb = clamp(m20 * r + m21 * g + m22 * b);
    data[i] = sr * cr + ir;
    data[i + 1] = sg * cg + ig;
    data[i + 2] = sb * cb + ib;
    // alpha (i+3) inchangé
  }
}

/** Nom sans extension. */
function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
/** Remplace l'extension du nom par `ext`. */
function withExt(name: string, ext: string): string {
  return `${baseName(name)}.${ext}`;
}

/**
 * Éditeur d'image admin : réglages non-destructifs (aperçu live) puis
 * « Enregistrer sous » qui exporte une COPIE retouchée comme nouveau fichier
 * dans le dossier choisi (via /api/upload). L'original n'est jamais modifié.
 */
export function ImageEditor({
  file,
  folders,
  onDone,
  onSaved,
}: {
  file: EditorFile;
  folders: Folder[];
  onDone: () => void;
  onSaved: (id: string) => void;
}) {
  const router = useRouter();
  const [adjust, setAdjust] = useState<Adjust>(ZERO);
  const [showSave, setShowSave] = useState(false);
  // Id de filtre unique par instance ; les « : » de useId sont retirés car
  // invalides dans une référence CSS url(#…).
  const filterId = `adjust-${useId().replace(/:/g, "")}`;

  const dirty = SLIDERS.some((s) => adjust[s.key] !== 0);
  const src = `/api/files/${file.id}?inline=1`;

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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowSave(true)}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
        >
          Enregistrer sous…
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => setAdjust(ZERO)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-40"
        >
          Réinitialiser
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900"
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

/** Modale « Enregistrer sous » : nom, dossier, format (PNG/JPEG), qualité. */
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

      // 1. Charge l'image à sa résolution native (même origine → canvas non
      // « tainted »). Timeout : une connexion qui pend ne déclenche pas onerror.
      const img = new Image();
      img.src = `/api/files/${file.id}?inline=1`;
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

      // 2. Dessine + applique les réglages sur les pixels.
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) throw new Error("Image illisible.");
      // Au-delà de la limite canvas du navigateur, le dessin échoue en silence
      // (canvas « neutered ») → on refuse plutôt que d'enregistrer une image vide.
      const MAX_DIM = 16384;
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
      // JPEG ne gère pas la transparence → fond blanc déterministe (sinon la
      // couleur de composition des zones transparentes dépend du navigateur).
      if (format === "jpg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      applyAdjust(imageData.data, adjust);
      ctx.putImageData(imageData, 0, 0);

      // 3. Encode dans le format choisi.
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(
          resolve,
          mime,
          format === "jpg" ? quality / 100 : undefined,
        ),
      );
      if (!blob) throw new Error("Échec de l'encodage.");

      // 4. Upload comme NOUVEAU fichier (l'original reste intact).
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
          Enregistrer sous…
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
