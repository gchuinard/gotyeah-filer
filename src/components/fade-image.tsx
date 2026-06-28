"use client";

import { useState } from "react";

/**
 * Image qui apparaît en fondu une fois chargée (transition de projection).
 * Mutualisée par la lightbox et la fenêtre publique du mode présentateur.
 */
export function FadeImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className: string;
  /** Style inline optionnel (ex. filtre de retouche live en projection). */
  style?: React.CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onLoad={() => setLoaded(true)}
      style={style}
      className={`${className} transition-opacity duration-1000 ease-in-out ${loaded ? "opacity-100" : "opacity-0"}`}
    />
  );
}
