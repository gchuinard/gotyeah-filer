# Filer

Petit service perso d'**auto-hébergement de partage de fichiers** (pour remplacer
WeTransfer / Grosfichiers dans un cadre familial). On dépose des fichiers, on les
range dans des dossiers, puis on les partage à des proches via un lien `/s/{token}`.

> Le **pourquoi / quoi** est dans [`CONTEXT.md`](./CONTEXT.md), les **conventions de
> code** dans [`CLAUDE.md`](./CLAUDE.md), le **suivi des phases** dans [`TODO.md`](./TODO.md).

## Fonctionnalités

- **Admin** (emails listés dans `ADMIN_EMAILS`) : upload (drag & drop, **streaming**, gros
  fichiers OK), **dossiers** pour ranger, création de **partages** d'un fichier **ou d'un
  dossier entier** (emails autorisés → lien + « copier »), révocation, suppression, download,
  **compteur de téléchargements** par fichier, **retouche d'image** (luminosité / contraste /
  saturation / RVB) : soit **« Enregistrer une copie »** (PNG ou JPEG, l'original reste intact),
  soit **« Écraser l'original »** (remplace définitivement le fichier, **avec confirmation**). Et
  un **mode présentateur (2 écrans)** façon PowerPoint : un écran **public** plein écran (l'image
  seule) piloté depuis une **régie** avec l'image **suivante**, des **notes** par fichier
  (enregistrées en base, éditables aussi dans l'explorateur), un **chrono**, et la **retouche en
  direct** (le réglage s'affiche en temps réel sur le projecteur) — placement auto du 2e écran sur
  Chrome/Edge, sinon fenêtre à glisser sur le vidéoprojecteur. Et une **télécommande** :
  pilote la projection (◀ ▶, **écran noir**, vignette « suivante », **note** éditable de l'image,
  **chrono** affiché et pilotable, et **retouche live** — régler les couleurs avec l'aperçu projeté
  en temps réel puis écraser l'original) **depuis ton téléphone** via un code d'appairage (page
  `/admin/remote`, relais SSE).
- **Explorateur** (admin & page invité) : vue **master‑détail** (liste à gauche, aperçu en
  grand au centre) avec **aperçu** des images, **lecture** audio/vidéo (seek via requêtes
  Range) et **PDF** en ligne, **mode projection** plein écran immersif (Fullscreen API, **sans
  chrome** ; flèches pour défiler, Échap pour sortir, **fondu** entre les images), **filtre par type**
  (images / audio / vidéo / fichiers), **recherche** par nom, **tri** (nom / date / taille),
  **multi‑sélection** (clic, shift‑clic) → actions groupées (déplacer / supprimer / télécharger
  en **.zip**), et **navigation au clavier** (↑/↓ fichiers, ←/→ dossiers, Entrée/Espace plein écran).
- **Invité** : via un lien `/s/{token}`, saisit son email ; s'il est autorisé pour ce
  partage (ou s'il est admin), il accède au contenu partagé. Pour un **partage de fichier**,
  il voit/lit le fichier + download. Pour un **partage de dossier**, il a l'explorateur ci‑dessus
  + un bouton **« Tout télécharger (.zip) »** (et le zip d'une sélection). Sinon, accès refusé.
  Un partage de dossier est « vivant » : il suit le contenu actuel du dossier.
- **Sécurité d'affichage** : seuls les types inertes (image hors SVG, audio, vidéo, PDF) sont
  servis *en ligne* ; tout le reste (html, svg…) est forcé en téléchargement.
- **Pas de comptes, pas de mot de passe, aucun email envoyé.** L'accès est une simple
  « porte » (email comparé à une liste) — compromis assumé, cf. `CONTEXT.md`.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS v4 · better-sqlite3 (un fichier `.db`,
schéma créé au boot) · stockage sur le système de fichiers · Docker (`output: 'standalone'`).

## Variables d'environnement

| Variable         | Requis | Description                                                                 |
| ---------------- | :----: | --------------------------------------------------------------------------- |
| `ADMIN_EMAILS`   |   ✅   | Emails admin, séparés par des virgules (comparaison insensible casse/espaces). |
| `SESSION_SECRET` |   ✅   | Secret de signature des cookies de session. Long et aléatoire.              |
| `APP_URL`        |   ✅   | URL publique (ex. `https://filer.gautierchuinard.com`) — sert à bâtir les liens de partage. |
| `MAX_UPLOAD_MB`  |   —    | Taille max d'un upload, en Mo (défaut `1024`).                              |
| `DATA_DIR`       |   —    | Répertoire des données (défaut `/data`). À ne définir qu'en dev local.      |

Générer un secret : `openssl rand -base64 48`. Voir [`.env.example`](./.env.example).
Ne **jamais** committer `.env`.

## Développement local

```bash
npm install
cp .env.example .env      # puis adapter ; en local : DATA_DIR=./data
npm run dev               # http://localhost:3000
```

Les données locales (fichiers + `filer.db`) vivent dans `./data` (gitignoré).

## Déploiement (Raspberry Pi / Docker)

L'app tourne dans **un seul conteneur**, exposée via **Nginx Proxy Manager** (NPM),
derrière **Cloudflare** (Full Strict). Image multi-stage, base Debian slim (Node 24),
sortie `standalone`.

### Prérequis sur le Pi

- Docker + Docker Compose v2.
- Le **réseau Docker externe partagé** que NPM possède déjà — ici `npm_net`.
  Vérifier : `docker network ls`. S'il n'existe pas, le créer et y rattacher NPM :
  ```bash
  docker network create npm_net
  ```
  > **Important (convention homelab)** : on rattache Filer à ce réseau externe
  > directement dans le `docker-compose.yml`. On ne fait **jamais** un
  > `docker network connect` manuel — il ne survit pas à une recréation du conteneur
  > NPM (c'est ce qui avait cassé le SSL d'un autre service).

### Mise en route

```bash
# 1. cloner au chemin attendu par le CI/CD
git clone git@github.com:gchuinard/gotyeah-filer.git /home/pi/sites/gotyeah-filer
cd /home/pi/sites/gotyeah-filer

# 2. créer le .env de prod
cat > .env <<'EOF'
ADMIN_EMAILS=gautierchuinard@gmail.com
SESSION_SECRET=<openssl rand -base64 48>
APP_URL=https://filer.gautierchuinard.com
MAX_UPLOAD_MB=1024
EOF

# 3. build + démarrage
docker compose up -d --build
```

Le service `filer` **expose** le port `3000` (uniquement sur le réseau Docker, pas de
`ports` publiés) et monte le volume nommé `filer_data` sur `/data` (fichiers + SQLite).

### Nginx Proxy Manager

Créer un **Proxy Host** :

- **Domain** : `filer.gautierchuinard.com`
- **Forward Hostname** : `filer` (le nom du conteneur, joignable sur `npm_net`)
- **Forward Port** : `3000` · **Scheme** : `http`
- **SSL** : certificat Let's Encrypt (ou origin Cloudflare), **Force SSL** activé.
- **Advanced** → augmenter la limite d'upload de NPM, sinon les gros fichiers sont coupés :
  ```nginx
  client_max_body_size 0;
  ```

### Cloudflare (Full Strict)

Le proxy Cloudflare limite le **corps des requêtes à 100 Mo** (plans Free/Pro).
Si des fichiers **> 100 Mo** sont attendus (bandes-son WAV…), deux options :

- passer `filer.gautierchuinard.com` en **DNS-only (grey cloud)** pour bypasser le proxy, ou
- prévoir un upload **chunké**.

Sinon, RAS.

## CI/CD (déploiement automatique)

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) : à chaque **push sur
`main`**, un job `build` (lint + build) puis un job `deploy` qui se connecte au Pi en SSH et
exécute :

```bash
cd /home/pi/sites/gotyeah-filer
git pull --ff-only origin main
docker compose up -d --build
docker image prune -f
```

**Secrets GitHub à créer** (repo → *Settings → Secrets and variables → Actions*) :

| Secret     | Valeur                                            |
| ---------- | ------------------------------------------------- |
| `SSH_HOST` | Hôte / IP du Pi                                   |
| `SSH_USER` | Utilisateur SSH (ex. `pi`)                        |
| `SSH_KEY`  | Clé privée SSH (PEM) ayant accès au Pi            |

> Prérequis : le repo doit déjà être cloné dans `/home/pi/sites/gotyeah-filer`,
> le `.env` présent, et le réseau `npm_net` existant. Tant que ce n'est pas le cas,
> le job `deploy` échoue (le job `build`, lui, passe).

## Sauvegarde

Tout l'état persistant est dans le volume `filer_data` (monté sur `/data`) :

- `/data/files/` — les fichiers uploadés (nommés par UUID),
- `/data/filer.db` (+ `-wal`, `-shm`) — la base SQLite (métadonnées, dossiers, partages).

Sauvegarder ce volume suffit à tout restaurer.

## Sécurité (rappel)

L'accès est une **porte**, pas une authentification réelle : n'importe qui connaissant un
email autorisé peut se faire passer pour lui (cf. `CONTEXT.md`). C'est assumé pour un usage
familial. Garder `SESSION_SECRET` **long et secret** ; le **changer invalide toutes les
sessions** en cours (utile pour révoquer un accès admin retiré de `ADMIN_EMAILS`).
