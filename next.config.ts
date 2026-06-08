import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build minimal autonome pour l'image Docker (cf. Dockerfile multi-stage)
  output: "standalone",
  // better-sqlite3 est un module natif : ne pas le bundler côté serveur
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
