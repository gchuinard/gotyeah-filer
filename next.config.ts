import type { NextConfig } from "next";

// En-têtes de sécurité appliqués à toutes les routes.
// La CSP est posée ICI (et non plus au bord, dans NPM) depuis le 22/10/2026 : elle
// vivait dans une ligne ajoutée À LA MAIN au fichier généré par NPM, absente de sa
// base — un simple « Save » de l'hôte l'aurait effacée. Versionnée ici, elle suit le
// code et couvre aussi la preprod. Production seulement : en dev, React Refresh a
// besoin d'`eval`. NB : une CSP sans script 'unsafe-inline' exigerait un nonce via
// proxy.ts (Next 16) — rendu dynamique forcé — ET un refactor des `style={{}}` React
// (éditeur d'image / projection), qui ne peuvent pas porter de nonce. À traiter à part.
// Le scan Sonar (05/07, 58/D) a montré que X-Frame-Options / nosniff / Referrer-Policy
// / HSTS étaient EN FAIT absents (filer n'est pas systématiquement derrière le proxy CF
// orange) → on les pose ici à la source pour qu'ils soient garantis sur toutes les routes,
// y compris les sous-ressources `_next/static`.
const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Anti-clickjacking : SAMEORIGIN, pas DENY — l'aperçu PDF affiche
  // `/api/files/<id>?inline=1` dans une <iframe> de NOTRE origine (explorateur,
  // galerie invité, lightbox, écran de projection) ; DENY le laissait blanc.
  // Le bord porte la même règle en CSP (`frame-ancestors 'self'`).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Anti-MIME-sniffing sur TOUTES les réponses (pages + JS/CSS statiques).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Évite la fuite d'URL interne vers les tiers.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Force HTTPS (site servi exclusivement en HTTPS + redirection en place).
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

// Directives (reprises telles quelles de la CSP de prod, éprouvée) :
// - script-src / style-src 'unsafe-inline' : hydratation Next.js (données Flight
//   inline) et styles inline React — sans eux, l'app n'est que du HTML mort
//   (incident CSP du 27/07/2026, cf. deploy/npm-advanced.conf) ;
// - img-src / media-src blob: : préchargement de projection hors-ligne ;
// - frame-ancestors 'self' (pas 'none') : l'aperçu PDF est une <iframe> de notre
//   origine (cohérent avec X-Frame-Options: SAMEORIGIN ci-dessus).
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  });
}

const nextConfig: NextConfig = {
  // Build minimal autonome pour l'image Docker (cf. Dockerfile multi-stage)
  output: "standalone",
  // better-sqlite3 est un module natif : ne pas le bundler côté serveur
  serverExternalPackages: ["better-sqlite3"],
  // Retire l'en-tête X-Powered-By: Next.js (divulgation de techno).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
