# Filer

Petit service perso d'**auto-hébergement de partage de fichiers** (pour remplacer
WeTransfer / Grosfichiers dans un cadre familial). On dépose des fichiers, on les
range dans des dossiers, puis on les partage à des proches via un lien `/s/{token}`.

> Le **pourquoi / quoi** est dans [`CONTEXT.md`](./CONTEXT.md), les **conventions de
> code** dans [`CLAUDE.md`](./CLAUDE.md), le **suivi des phases** dans [`TODO.md`](./TODO.md).

## Fonctionnalités

- **Admin** (emails listés dans `ADMIN_EMAILS`) : upload (drag & drop) **par morceaux de
  16 Mio, plusieurs en parallèle** — des fichiers de **plusieurs dizaines de Go** passent Cloudflare et NPM, avec
  reprise automatique sur coupure réseau ou redémarrage du serveur, vitesse et temps restant,
  et avertissement avant de fermer l'onglet pendant un envoi —, **dossiers** pour ranger, création de **partages** d'un fichier **ou d'un
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
- **Lien public** : depuis « Partager », un clic crée un lien **sans e-mail** (valable 1, 7 ou 30 jours, ou sans expiration) et le copie : il suffit de l'envoyer. Révocable comme les autres partages.
- **Invité** : via un lien `/s/{token}`, saisit son email ; s'il est autorisé pour ce
  partage (ou s'il est admin), il accède au contenu partagé. Pour un **partage de fichier**,
  il voit/lit le fichier + download (**reprenable** : un téléchargement coupé repart là où il
  s'était arrêté). Pour un **partage de dossier**, il a l'explorateur ci‑dessus
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
| `MAX_UPLOAD_MB`  |   —    | Taille max d'un fichier, en Mo (défaut `1024` ; prod : `102400` = 100 Go). L'envoi est aussi refusé d'emblée si le disque n'a pas la place. |
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
MAX_UPLOAD_MB=102400
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
- **Advanced** → coller le bloc de [`deploy/npm-advanced.conf`](./deploy/npm-advanced.conf)
  (dérogation de taille scopée à `/api/upload`, avec `proxy_request_buffering on`). La CSP n'est **pas** dans NPM : l'app la pose elle-même (`next.config.ts`, en production). Depuis l'upload par morceaux, les
  requêtes d'envoi font au plus 24 Mio et passent même sous le plafond de 25 Mo que ce NPM
  impose à tous les hôtes ; la dérogation ne sert plus que de marge.

### Cloudflare (Full Strict)

Le proxy Cloudflare limite le **corps des requêtes à 100 Mo** (plans Free/Pro), et Node
coupe toute requête encore en réception après **300 s**. D'où l'upload **par morceaux de
16 Mio** (`/api/upload/sessions`) : chaque requête est petite et courte, quelle que soit la
taille du fichier — pas besoin de passer en DNS-only. Cloudflare reçoit chaque morceau en
entier avant de le transmettre : l'interface en envoie donc **4 à la fois** par fichier, pour
que ces attentes se recouvrent au lieu de s'additionner.

Les téléchargements, eux, ne sont pas plafonnés par Cloudflare. Ils sont **reprenables**
(`Range` / `If-Range` / `ETag`) et servis en `no-transform` (pas de recompression à la volée,
`Content-Length` conservé). Servir de très gros fichiers via le plan gratuit peut en principe
contrevenir aux conditions d'usage de Cloudflare : risque faible pour un usage ponctuel.

> ⚠️ **Ne pas pousser sur `main` pendant un gros envoi** : le déploiement redémarre le
> conteneur. L'envoi reprend tout seul dans l'onglet, mais autant ne pas l'imposer.

## CI/CD (déploiement automatique)

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) : à chaque **push sur
`main`**, un job `build` (lint + build) puis un job `deploy` qui se connecte au Pi en SSH
avec une clé dédiée à Filer. Sur le Pi, `authorized_keys` force cette clé sur
`/usr/local/sbin/gotyeah-deploy filer` : le job n'envoie que `deploy`, le Pi fait un
`git fetch` dans `/home/pi/sites/gotyeah-filer`, puis exécute
[`deploy/pi-deploy.sh`](./deploy/pi-deploy.sh) tel qu'il est dans `origin/main` :

```bash
git merge --ff-only "$CIBLE"   # CIBLE = origin/main, déjà récupéré par le git fetch
docker compose up -d --build --wait --wait-timeout 120
docker image prune -f
```

Les étapes du déploiement se changent donc dans `deploy/pi-deploy.sh`, plus dans le
workflow. Jusqu'au 25/09/2026, le job envoyait ces commandes lui-même (avec
`git pull --ff-only origin main`), avec une clé qui ouvrait tout le Pi ; une clé volée ne
peut plus que redéployer `main` (et déposer des résultats Allure, comme toute clé de
déploiement du parc).

Depuis le 25/09/2026, `--wait` attend que le `healthcheck` du compose passe au vert : un
conteneur qui ne répond pas fait échouer le job, alors qu'avant `up -d` rendait 0 dès que
le conteneur était créé. Deux déploiements ne tournent plus en même temps : un push
arrivé pendant un déploiement attend la fin de celui-ci.

**Secrets GitHub à créer** (repo → *Settings → Secrets and variables → Actions*) :

| Secret                 | Valeur                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `SSH_HOST`             | Hôte / IP du Pi                                                                          |
| `SSH_USER`             | Utilisateur SSH (ex. `pi`)                                                               |
| `SSH_KEY`              | Clé privée SSH dédiée à Filer, forcée sur `gotyeah-deploy filer` dans `authorized_keys`  |
| `SSH_HOST_FINGERPRINT` | Empreinte SHA256 de la clé d'hôte ECDSA du Pi ; sans elle, le job refuse de déployer     |

> Prérequis : le repo doit déjà être cloné dans `/home/pi/sites/gotyeah-filer` (le
> `git fetch` du Pi doit y marcher sans intervention), le `.env` présent, le réseau
> `npm_net` existant, et la clé publique posée dans `~pi/.ssh/authorized_keys` avec
> `restrict,command="/usr/local/sbin/gotyeah-deploy filer"`. Tant que ce n'est pas le
> cas, le job `deploy` échoue (le job `build`, lui, passe).

## Sauvegarde

Tout l'état persistant est dans le volume `filer_data` (monté sur `/data`) :

- `/data/files/` — les fichiers uploadés (nommés par UUID),
- `/data/filer.db` (+ `-wal`, `-shm`) — la base SQLite (métadonnées, dossiers, partages),
- `/data/uploads/` — les envois **en cours** (fichiers partiels `.part`, purgés au bout de
  6 h d'inactivité) : **inutile à sauvegarder**, à exclure.

Sauvegarder ce volume suffit à tout restaurer.

## Sécurité (rappel)

L'accès est une **porte**, pas une authentification réelle : n'importe qui connaissant un
email autorisé peut se faire passer pour lui (cf. `CONTEXT.md`). C'est assumé pour un usage
familial. Garder `SESSION_SECRET` **long et secret** ; le **changer invalide toutes les
sessions** en cours (utile pour révoquer un accès admin retiré de `ADMIN_EMAILS`).
