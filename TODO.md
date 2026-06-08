# Filer — Suivi des phases

> Phase courante : **Phase 4 (Partages) terminée — en attente de validation (gate) avant la Phase 5.**
> Règle : à la fin de chaque phase → stop, résumé, attendre le feu vert.

## Phase 1 — Scaffold ✅
- [x] Next.js 16 + TypeScript + Tailwind v4 (App Router, src/, alias @/*)
- [x] `next.config.ts` : `output: 'standalone'` + `serverExternalPackages: ['better-sqlite3']`
- [x] Dépendance better-sqlite3 (+ @types) installée
- [x] Dockerfile multi-stage (standalone) + docker-compose.yml (service unique, expose, réseau externe, volume /data) + .dockerignore
- [x] `.env.example` (ADMIN_EMAILS, SESSION_SECRET, MAX_UPLOAD_MB, APP_URL) et `.gitignore` (/data, .env)
- [x] Fichiers de suivi : CONTEXT.md, CLAUDE.md, TODO.md
- [x] UI de base nettoyée (FR, dark, placeholder sobre)
- → **GATE** : validation avant Phase 2

## Phase 2 — Porte & sessions ✅
- [x] Page d'accueil : saisie email (+ espace admin placeholder avec déconnexion)
- [x] Vérification contre `ADMIN_EMAILS` (normalisation minuscules + trim)
- [x] Cookie de session signé httpOnly — JWT HS256 via `jose` (secret `SESSION_SECRET`), ~30 j, `sameSite=lax`, payload email + rôle
- [x] Protection des routes admin via `proxy.ts` (ex-middleware, renommé en Next 16)
- → **GATE** : validation avant Phase 3

## Phase 3 — Fichiers (admin) ✅
- [x] Initialisation SQLite au boot (tables files, shares si absentes)
- [x] Upload via Route Handler en streaming (`app/api/upload/route.ts`), limite `MAX_UPLOAD_MB`
- [x] Stockage `/data/files` sous nom unique (crypto.randomUUID), nom d'origine en base
- [x] Liste des fichiers (nom d'origine, taille, date) + drag & drop + progression
- [x] Suppression d'un fichier (+ ses partages) — `DELETE /api/files/[id]`
- [x] Download admin (`GET /api/files/[id]`, streaming, Content-Disposition: attachment, nosniff)
- → **GATE** : validation avant Phase 4

## Phase 4 — Partages ✅
- [x] Création d'un partage : 1+ emails autorisés → token → lien `/s/{token}` + bouton « Copier le lien »
- [x] Page invité `/s/{token}` : saisie email, contrôle d'accès, affichage fichier (nom, taille) + Télécharger, sinon refus sobre (nom du fichier non révélé avant accès)
- [x] Contrôle d'accès au download par partage (admin OU invité autorisé pour CE partage, scopé au fichier)
- [x] (Bonus) Lister / révoquer les partages
- → **GATE** : validation avant Phase 5

## Phase 5 — Finitions UI
- [ ] Dark mode cohérent, responsive / mobile-first
- [ ] Feedbacks : upload en cours, « lien copié », accès refusé, états vides
- → **GATE**

## Phase 6 — Déploiement
- [x] CI/CD GitHub Actions (build + déploiement SSH vers le Pi) — fait en avance.
      Prérequis côté Pi : secrets `SSH_HOST`/`SSH_USER`/`SSH_KEY`, repo cloné dans
      `/home/pi/sites/gotyeah-filer`, `.env` présent, réseau `npm_net` existant.
- [ ] Build de l'image Docker
- [ ] README : docker-compose, variables d'env, config Nginx Proxy Manager, note Cloudflare (limite 100 Mo)
- → **GATE finale**
