# Filer — Règles & conventions du repo

Guide à destination d'un assistant IA (Claude Code) travaillant dans ce repo.

## Stack (versions réelles installées)
- Next.js 16.2.7 (App Router, TypeScript), React 19.2.4.
- Tailwind CSS v4 (via `@tailwindcss/postcss` ; config CSS-first dans `src/app/globals.css`, **pas** de `tailwind.config`).
- better-sqlite3 (persistance, un seul fichier `.db`) — déclaré dans `serverExternalPackages` (`next.config.ts`) car module natif.
- ESLint (`eslint-config-next`), répertoire `src/`, alias d'import `@/*`.
- Docker : build multi-stage, `output: 'standalone'`.

## Contraintes dures (NE PAS faire)
- Pas de comptes / mots de passe / inscription.
- Pas de magic link. L'app n'envoie **AUCUN** email (pas de SMTP/Brevo).
- Pas de scan antivirus.
- Pas d'ORM (pas de Prisma) ni de système de migrations : schéma SQLite créé au boot s'il est absent.
- Pas de sur-ingénierie UI (shadcn/ui seulement si ça simplifie vraiment).

## Conventions de code
- TypeScript partout. Composants serveur par défaut (App Router).
- **Uploads** : toujours via Route Handler (`app/api/upload/route.ts`) en streaming vers le disque — **JAMAIS** via Server Action (limite `bodySizeLimit` ~1 Mo). Taille max configurable via `MAX_UPLOAD_MB` (défaut 1024).
- **Stockage** : écrire dans `/data/files` sous un nom de stockage unique (`crypto.randomUUID`) ; conserver le nom d'origine en base. Le `.db` SQLite vit sous `/data`.
- **Emails** : normaliser systématiquement (minuscules + trim) des **DEUX** côtés (liste `.env` / partage ET saisie utilisateur) avant comparaison.
- **Sessions** : cookie signé, `httpOnly`, secret `SESSION_SECRET`, stateless (aucun stockage DB), durée ~30 jours, contenant email + rôle (+ token de partage si invité).
- **Download** : Route Handler dédiée, streaming, `Content-Disposition: attachment`, **APRÈS** contrôle de session (admin, ou invité autorisé pour ce partage précis).

## Schéma SQLite (créé au démarrage si absent)
- `files(id TEXT PK, stored_name TEXT, original_name TEXT, size INTEGER, mime TEXT, created_at INTEGER, folder_id TEXT /* NULL = racine */)`
- `shares(token TEXT PK, file_id TEXT, allowed_emails TEXT /* JSON array */, created_at INTEGER)`
- `folders(id TEXT PK, name TEXT, created_at INTEGER)`
- Évolution de schéma **sans framework de migration** : colonnes ajoutées au boot de façon idempotente (`ensureColumn` → `ALTER TABLE … ADD COLUMN` si absente).

## Variables d'environnement
- `ADMIN_EMAILS` (liste séparée par virgules), `SESSION_SECRET`, `MAX_UPLOAD_MB`, `APP_URL`.
- Voir `.env.example`. Ne **jamais** committer `.env`.

## Commandes
- `npm run dev` — développement.
- `npm run build` — build prod.
- `npm run start` — démarrage prod.
- `npm run lint` — lint.

## Workflow
- **Commits sémantiques** (`feat:`, `fix:`, `chore:`, `docs:`…), atomiques.
- **Avancer par phases avec gate de validation** : à la fin de chaque phase, s'arrêter, résumer ce qui est fait, et attendre le feu vert avant la phase suivante. Les phases sont listées dans `TODO.md`.
- Fichiers de suivi : `CONTEXT.md` (pourquoi/quoi), `CLAUDE.md` (ce fichier), `TODO.md` (phases).

## Déploiement / gotchas
- `docker-compose` : un seul service, `expose` (pas `ports`), volume nommé monté sur `/data`.
- **Réseau Docker (convention homelab — important)** : rattacher le service à un réseau **externe que Nginx Proxy Manager possède déjà** (`npm_net`, déclaré `external: true`), **jamais** à un réseau `*_default` isolé créé par le projet. Ainsi le service est sur le réseau dès le `up` et NPM le voit sans bidouille. Ne PAS compter sur un `docker network connect` manuel : il ne survit pas à une recréation du conteneur NPM (c'est ce qui avait cassé le SSL de `gotyeah-stack`). Vérifier le hub : `docker network ls` (probablement `npm_net`, sinon `nginx-proxy-manager_default`).
- **Image Docker** : base Debian slim (`node:24-bookworm-slim`), **pas** Alpine — better-sqlite3 est un module natif et le prebuild musl peut manquer (sinon recompilation python/make/g++). Node 24 (Active LTS, aligné sur le dev).
- Cloudflare en Full (Strict). Le proxy CF limite le body à 100 Mo (Free/Pro) → pour >100 Mo, DNS-only (grey cloud) ou upload chunké.

## Règles Next.js (bloc auto-géré)

Bloc recopié intégralement depuis `AGENTS.md` — ne pas modifier à la main.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
