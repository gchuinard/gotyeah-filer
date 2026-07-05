import type { NextConfig } from "next";

// En-têtes de sécurité appliqués à toutes les routes.
// NB : la CSP n'est PAS posée ici. Une CSP propre (sans script 'unsafe-inline')
// exigerait un nonce via proxy.ts (Next 16) — ce qui force le rendu dynamique —
// ET un refactor des composants qui utilisent `style={{}}` React (éditeur d'image /
// projection), les styles inline React ne pouvant pas porter de nonce. À traiter à part.
// La CSP `default-src 'self'` observée en prod est posée au bord (Cloudflare/NPM).
// Le scan Sonar (05/07, 58/D) a montré que X-Frame-Options / nosniff / Referrer-Policy
// / HSTS étaient EN FAIT absents (filer n'est pas systématiquement derrière le proxy CF
// orange) → on les pose ici à la source pour qu'ils soient garantis sur toutes les routes,
// y compris les sous-ressources `_next/static`.
const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Anti-clickjacking (le bord peut aussi porter frame-ancestors via la CSP).
  { key: "X-Frame-Options", value: "DENY" },
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
