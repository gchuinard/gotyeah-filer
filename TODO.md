# Filer — Suivi des phases

> Phase courante : **Phase 1 (Scaffold) terminée — en attente de validation (gate) avant la Phase 2.**
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

## Phase 2 — Porte & sessions
- [ ] Page d'accueil : saisie email
- [ ] Vérification contre `ADMIN_EMAILS` (normalisation minuscules + trim)
- [ ] Cookie de session signé, httpOnly (secret `SESSION_SECRET`), ~30 jours, contenant email + rôle
- [ ] Protection des routes admin via middleware
- → **GATE**

## Phase 3 — Fichiers (admin)
- [ ] Initialisation SQLite au boot (tables files, shares si absentes)
- [ ] Upload via Route Handler en streaming (`app/api/upload/route.ts`), limite `MAX_UPLOAD_MB`
- [ ] Stockage `/data/files` sous nom unique (crypto.randomUUID), nom d'origine en base
- [ ] Liste des fichiers (nom d'origine, taille, date)
- [ ] Suppression d'un fichier (+ ses partages)
- [ ] Download admin (Route Handler streaming, Content-Disposition: attachment)
- → **GATE**

## Phase 4 — Partages
- [ ] Création d'un partage : 1+ emails autorisés → token → lien `/s/{token}` + bouton « Copier le lien »
- [ ] Page invité `/s/{token}` : saisie email, contrôle d'accès, affichage fichier (nom, taille) + Télécharger, sinon refus sobre
- [ ] Contrôle d'accès au download par partage (admin OU invité autorisé pour CE partage)
- [ ] (Bonus) Lister / révoquer les partages
- → **GATE**

## Phase 5 — Finitions UI
- [ ] Dark mode cohérent, responsive / mobile-first
- [ ] Feedbacks : upload en cours, « lien copié », accès refusé, états vides
- → **GATE**

## Phase 6 — Déploiement
- [ ] Build de l'image Docker
- [ ] README : docker-compose, variables d'env, config Nginx Proxy Manager, note Cloudflare (limite 100 Mo)
- → **GATE finale**
