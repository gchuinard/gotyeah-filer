/* ---- Réglages de retouche d'image (luminosité / contraste / saturation / RVB) -
 * Type + maths PARTAGÉS entre :
 * - l'éditeur (`image-editor.tsx`) : aperçu via filtre SVG (`AdjustFilter`) + export
 *   via la boucle pixel `applyAdjust` (même math) ;
 * - la fenêtre publique du mode présentateur (`projection-screen.tsx`) : aperçu
 *   LIVE sur le projecteur via le même filtre SVG.
 * Centraliser ici garantit un rendu identique partout. */

/** Réglages de retouche (chaque valeur ∈ [-100, 100], 0 = inchangé). */
export type Adjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  red: number;
  green: number;
  blue: number;
};

export const ZERO_ADJUST: Adjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  red: 0,
  green: 0,
  blue: 0,
};

export const SLIDERS: { key: keyof Adjust; label: string }[] = [
  { key: "brightness", label: "Luminosité" },
  { key: "contrast", label: "Contraste" },
  { key: "saturation", label: "Saturation" },
  { key: "red", label: "Rouge" },
  { key: "green", label: "Vert" },
  { key: "blue", label: "Bleu" },
];

/** Convertit un réglage [-100, 100] en facteur multiplicatif (0 → 1). */
export const adjustFactor = (v: number) => 1 + v / 100;

/** Au moins un réglage est-il actif (≠ 0) ? */
export function isAdjusted(a: Adjust): boolean {
  return SLIDERS.some((s) => a[s.key] !== 0);
}

/**
 * Applique les mêmes réglages que le filtre SVG (cf. `AdjustFilter`), mais sur
 * les pixels bruts pour l'EXPORT (déterministe, sans dépendre de `ctx.filter`
 * que Safari gère mal). `data` est un Uint8ClampedArray : l'affectation clampe
 * et arrondit toute seule.
 */
export function applyAdjust(data: Uint8ClampedArray, a: Adjust): void {
  const S = adjustFactor(a.saturation);
  const B = adjustFactor(a.brightness);
  const C = adjustFactor(a.contrast);

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
  const gr = adjustFactor(a.red),
    gg = adjustFactor(a.green),
    gb = adjustFactor(a.blue);
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
