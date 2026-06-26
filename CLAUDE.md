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
- **Download** : Route Handler dédiée, streaming, `Content-Disposition: attachment`, **APRÈS** contrôle de session (admin, ou invité autorisé pour ce partage précis). Un vrai download incrémente `download_count`.
- **Aperçu / lecture inline** (`GET /api/files/[id]?inline=1`) : sert le fichier `inline` pour l'aperçu/lecture (vignette, image, audio, vidéo, PDF) — **ne compte PAS** comme un download. Honore les requêtes **Range** (seek). **Sécurité** : `inline` n'est servi que pour les types **inertes** sûrs (image hors SVG, audio, vidéo, PDF — cf. `isInlineSafe`) ; tout le reste (html, svg…) est **forcé en `attachment`** même avec `?inline=1`. Le `Content-Type` est déduit de l'extension si le MIME stocké est absent/générique (`mediaContentType`). Toujours `X-Content-Type-Options: nosniff`.
- **Zip** : archives de dossier / de sélection en streaming via `yazl` (helper `src/lib/zip.ts`, pré-`stat` des blobs + handler d'erreur).
- **UI** : confirmations destructives via la modale `useConfirm()` (`src/components/confirm-dialog.tsx`) — **jamais** `window.confirm`. Composants transverses mutualisés dans `src/components/` (filtres, tri, lightbox, modales).
- **Lightbox / « mode projection »** (`src/components/lightbox.tsx`, partagée admin & invité) : vrai plein écran via Fullscreen API — `requestFullscreen` déclenché en **`useLayoutEffect`** (pour rester dans le geste utilisateur, sinon Firefox/Safari refusent), repli webkit Safari/iPad, repli overlay si non supporté (iPhone). En plein écran réel : **aucun chrome** (flèches/bouton masqués), navigation **clavier** (←/→), Échap = sortir = fermer la projection. Images affichées avec **fondu d'apparition** (`FadeImage` : opacité pilotée par `onLoad`). Callbacks en `ref` + `aliveRef` pour éviter `setState` après démontage.
- **Projection hors-ligne** (`src/lib/use-image-preload.ts`, `src/components/projection-prep.tsx`) : mode pour projeter pendant un spectacle sans craindre un hoquet réseau. `useImagePreload(files, enabled)` précharge **uniquement les images** de la vue courante en **blobs (`URL.createObjectURL`, RAM navigateur — PAS de disque/SW/IndexedDB)**, **dans l'ordre de la liste**, via un **pool à concurrence limitée** avec **retry sur échec réseau** (pour que le cache se complète malgré un réseau flaky). Renvoie une `Map<id, objectURL>` + progression ; **révoque** tous les object URLs au cleanup/désactivation (`aliveRef` contre les `setState` post-démontage ; `setState` placé dans des fonctions imbriquées pour `react-hooks/set-state-in-effect`). La `Lightbox` accepte `srcMap?` et l'aperçu central résout `urls.get(id) ?? URL réseau` (repli transparent). Toggle `ProjectionPrep` (« Préparer / Désactiver » + progression) **partagé admin & invité**. Stockage **volatile** : un reload perd le cache (compromis assumé vs PWA).
- **Mode présentateur (2 écrans, admin)** (`src/components/projection-regie.tsx`, `src/components/projection-screen.tsx`, route `/admin/projection`, canal `src/lib/projection-channel.ts`) : « présentateur » façon PowerPoint. Une **console RÉGIE** (image courante + **suivante** + **notes** + **chrono**, sur l'écran de l'opérateur) pilote une **fenêtre PUBLIC** (l'image seule, plein écran, **sans chrome**, fondu, curseur masqué) posée sur le 2e écran / vidéoprojecteur. **Synchro temps réel via `BroadcastChannel`** (même origine ; la **position circule dans les DEUX sens** : régie OU clavier de la fenêtre public ; garde anti-écho `lastIdxRef` côté régie ; handshake `hello`→`sync`, puis `index` / `progress` / `close` / `public-closed`). Placement **auto** de la fenêtre public sur le 2e écran via **Multi-Screen Window Placement API** (`getScreenDetails` + `screen.isExtended`, **Chrome/Edge**, 1 autorisation) ; sinon **popup standard** à glisser + plein écran. ⚠️ Le **vrai plein écran exige un geste utilisateur** → la fenêtre fraîchement ouverte ne peut pas l'auto-déclencher : bouton « Plein écran » / touche **F**. ⚠️ Les **object URLs de préchargement ne traversent PAS les fenêtres** (liés à leur document) → la **fenêtre public précharge ses PROPRES blobs** (`useImagePreload`, toujours actif) et ne renvoie que sa **progression** à la régie. **Notes** = bloc-notes **local par image** (`src/lib/use-local-notes.ts`, `localStorage` clé `filer:note:{id}` ; **aucun champ en base**, perdu hors de ce navigateur — compromis assumé). **Chrono** (`src/components/presenter-timer.tsx`) = temps **total** + temps **par image** (remis à zéro au changement, total continu), pause/reprise/reset, **ancré timestamps** (pas de dérive). Clavier régie (←/→/Échap) **inactif pendant la saisie des notes**. Helpers plein écran (`src/lib/fullscreen.ts`) et `FadeImage` (`src/components/fade-image.tsx`) **mutualisés** avec la lightbox. **Zéro changement de base, rien côté serveur** hors la route d'affichage. **Pas de parité invité** (volontairement non fait). Contraintes React 19 respectées : `react-hooks/refs` (refs écrits dans un effet, jamais pendant le render), `react-hooks/purity` (pas de `Date.now()` pendant le render → instant en state), `set-state-in-effect`.
- **Retouche d'image (admin)** (`src/components/image-editor.tsx`) : **non-destructive**. APERÇU live = filtre **SVG inline** (`feColorMatrix` saturate + `feComponentTransfer` linéaire par canal, **`color-interpolation-filters="sRGB"`**). EXPORT = **boucle pixel `<canvas>`** avec **exactement la même math** (clamp intermédiaire compris) — **PAS** de `ctx.filter` (mal géré par Safari). `toBlob(png|jpg)` → **upload comme NOUVEAU fichier** via `/api/upload` (l'original reste intact). Garde-fous : limite taille canvas (16384 px), fond blanc en JPEG, timeout de chargement, `useId()` pour l'id du filtre SVG.

## Schéma SQLite (créé au démarrage si absent)
- `files(id TEXT PK, stored_name TEXT, original_name TEXT, size INTEGER, mime TEXT, created_at INTEGER, folder_id TEXT /* NULL = racine */, download_count INTEGER DEFAULT 0)`
- `shares(token TEXT PK, file_id TEXT /* NULL si partage de dossier */, folder_id TEXT /* NULL si partage de fichier */, allowed_emails TEXT /* JSON array */, created_at INTEGER)` — **un partage vise EXACTEMENT un fichier OU un dossier** (`CHECK ((file_id IS NOT NULL) <> (folder_id IS NOT NULL))`).
- `folders(id TEXT PK, name TEXT, created_at INTEGER)`
- Évolution de schéma **sans framework de migration** : colonnes ajoutées au boot de façon idempotente (`ensureColumn` → `ALTER TABLE … ADD COLUMN` si absente). Cas particulier : passer `shares.file_id` de `NOT NULL` à nullable (ajout du partage de dossier) **n'est pas faisable par ALTER** → reconstruction idempotente de la table au boot (`ensurePolymorphicShares`, ne s'exécute que sur une base historique, conserve les partages).

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
- **Taille d'upload côté NPM (gotcha 413)** : ce NPM force `client_max_body_size 25m` pour **tous** les hosts via `/data/nginx/custom/server_proxy.conf` (cap voulu pour chatpitre ; le défaut http de base est pourtant `2000m`). Sans override, Filer hérite des 25 Mo → « 413 Request Entity Too Large » (page **nginx**, pas l'app) au-delà. **Fix déployé** : override **scopé `/api/upload`** dans l'onglet **Advanced** du proxy host Filer (cf. `deploy/npm-advanced.conf`) — `client_max_body_size 0` (délégué à `MAX_UPLOAD_MB`, 1024 Mo) au niveau `location` pour ne pas faire doublon avec le 25m server-level. Persistant en base NPM. **Ne PAS** toucher au réglage global (autres sites en prod). Ce n'est PAS un correctif de code. Cloudflare plafonne quand même à 100 Mo au-dessus.
- Cloudflare en Full (Strict). Le proxy CF limite le body à 100 Mo (Free/Pro) → pour >100 Mo, DNS-only (grey cloud) ou upload chunké.

## Règles Next.js (bloc auto-géré)

Bloc recopié intégralement depuis `AGENTS.md` — ne pas modifier à la main.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
