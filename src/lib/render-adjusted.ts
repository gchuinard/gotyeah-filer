"use client";

import { applyAdjust, type Adjust } from "@/lib/image-adjust";

/* Rendu d'une image retouchée vers un blob — PARTAGÉ par l'éditeur
 * (`image-editor.tsx`) et la régie (commit de retouche venue de la télécommande).
 * Boucle pixel `<canvas>` avec EXACTEMENT la même math que le filtre SVG de
 * l'aperçu (cf. `applyAdjust`), PAS `ctx.filter` (mal géré par Safari). */

/** Limite de taille canvas du navigateur (au-delà, le dessin échoue en silence). */
const MAX_DIM = 16384;

type NamedFile = { original_name: string; mime: string | null };

/** Format d'écrasement : on conserve le type de l'original (sinon JPEG). */
export function overwriteMime(file: NamedFile): string {
  const name = file.original_name.toLowerCase();
  if (file.mime === "image/png" || name.endsWith(".png")) return "image/png";
  if (file.mime === "image/webp" || name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Rend l'image retouchée dans un blob. `bust` force le rechargement des octets
 * COURANTS (utile pour un 2e écrasement de suite : l'aperçu inline est caché ~5 min).
 */
export async function renderAdjusted(
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
