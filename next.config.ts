import type { NextConfig } from "next";

// En-têtes de sécurité appliqués à toutes les routes.
// NB : la CSP n'est PAS posée ici. Une CSP propre (sans script 'unsafe-inline')
// exigerait un nonce via proxy.ts (Next 16) — ce qui force le rendu dynamique —
// ET un refactor des composants qui utilisent `style={{}}` React (éditeur d'image /
// projection), les styles inline React ne pouvant pas porter de nonce. À traiter à part.
// HSTS / X-Frame-Options / Referrer-Policy / nosniff sont déjà présents (Cloudflare + routes).
const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Build minimal autonome pour l'image Docker (cf. Dockerfile multi-stage)
  output: "standalone",
  // better-sqlite3 est un module natif : ne pas le bundler côté serveur
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
