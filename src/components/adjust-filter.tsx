import { type Adjust, adjustFactor } from "@/lib/image-adjust";

/**
 * Filtre SVG inline pour l'APERÇU live (appliqué à une `<img>` via
 * `style={{ filter: url(#id) }}`). `color-interpolation-filters="sRGB"` est
 * essentiel : sans lui le filtre opère en linearRGB et le rendu ne correspondrait
 * plus à l'export (boucle pixel sRGB, cf. `applyAdjust`). Saturation via
 * feColorMatrix, puis contraste + luminosité + gain par canal repliés dans une
 * transformation linéaire par canal (feComponentTransfer).
 *
 * Mutualisé par l'éditeur de retouche et la fenêtre publique du mode présentateur
 * (aperçu live sur le projecteur). L'`id` doit être unique par instance montée.
 */
export function AdjustFilter({ a, id }: { a: Adjust; id: string }) {
  const f = adjustFactor;
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
