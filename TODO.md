# Filer — Suivi des phases

> **Toutes les phases (1 → 6) terminées.** Le projet est prêt à déployer.
> Règle de travail : à la fin de chaque phase → stop, résumé, attendre le feu vert.

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
- [x] Dark mode cohérent, responsive / mobile-first
- [x] Feedbacks : upload en cours, « lien copié », accès refusé, états vides (+ 404 sobre, titres de page)
- [x] (Ajout demandé) Dossiers : créer / renommer / supprimer, déplacer un fichier, upload dans le dossier actif, filtre par dossier
- → **GATE** : validation avant Phase 6

## Phase 6 — Déploiement ✅
- [x] CI/CD GitHub Actions (build + déploiement SSH vers le Pi) — fait en avance.
      Prérequis côté Pi : secrets `SSH_HOST`/`SSH_USER`/`SSH_KEY`, repo cloné dans
      `/home/pi/sites/gotyeah-filer`, `.env` présent, réseau `npm_net` existant.
- [x] Artefact `standalone` validé : binaire natif better-sqlite3 tracé + serveur de
      prod testé de bout en bout (DB/upload/download/dossiers/partages).
      (Le build de l'image Docker se fait sur le Pi : Docker absent du WSL de dev.)
- [x] README complet : env, docker-compose, Nginx Proxy Manager, Cloudflare (100 Mo),
      prérequis Pi, secrets CI/CD, sauvegarde, sécurité.
- → **GATE finale** : validation

## Ajouts post-lancement (hors phases, livrés à la demande) ✅
- [x] Aperçu des images + **compteur de téléchargements** (`download_count`).
- [x] **Partage de dossier** (partage polymorphe fichier/dossier, CHECK XOR + migration
      idempotente `ensurePolymorphicShares`) + **téléchargement zip** (dossier ET sélection, `yazl`).
- [x] UI **master-détail** : aside (liste défilante) + aperçu au centre, admin & page invité.
- [x] **Aperçu/lecture inline** : audio (mp3/wav…), vidéo (mp4/webm…), **PDF** ; Content-Type
      déduit de l'extension + requêtes **Range** (seek) ; `inline` réservé aux types sûrs.
- [x] **Mode projection** (lightbox) : **plein écran immersif réel** (Fullscreen API +
      repli webkit Safari/iPad ; dégradation gracieuse en overlay sur iPhone). En plein écran,
      **aucun chrome** par-dessus l'image (flèches/bouton masqués) → navigation au **clavier**
      (←/→), Échap pour sortir. **Fondu d'apparition** des images (~1 s, ease-in-out).
      Entrée/Espace ou clic pour ouvrir. **Admin & invité.**
- [x] **Multi-sélection** (clic, shift-clic) + actions groupées (déplacer / supprimer / zip).
- [x] **Filtre par type**, **recherche** par nom, **tri** (nom / date / taille).
- [x] **Navigation clavier** : ↑/↓ fichiers, ←/→ dossiers, Entrée/Espace plein écran.
- [x] **Modale de confirmation** stylée (remplace `window.confirm`) ; **modale de partage**
      (e-mails en chips : ajouter/supprimer, pas d'édition).
- [x] **Retouche d'image** (admin) : réglages non-destructifs **luminosité / contraste /
      saturation / RVB** (aperçu live via filtre SVG) ; **« Enregistrer sous »** exporte une
      **copie** retouchée (canvas + boucle pixel = même rendu que l'aperçu) comme **nouveau
      fichier** dans le dossier choisi, en **JPEG ou PNG** (défaut selon l'image d'entrée),
      via `/api/upload`. L'original n'est **jamais** modifié.
- [x] **Mode projection hors-ligne** (spectacle) : bouton **« Préparer »** qui précharge les
      images de la vue courante en **blobs (RAM navigateur)** — pool à concurrence limitée +
      **retry** sur échec réseau, dans l'ordre de la liste. Une fois prêt, l'aperçu central et
      la lightbox lisent depuis le cache → **navigation image→image sans réseau** (plus de 404
      si la connexion hoquette en plein spectacle). Object URLs **révoqués** au cleanup ;
      stockage volatile (perdu au reload). Partagé **admin & invité**. Images uniquement.
- [x] **Mode présentateur** (2 écrans, **admin**) façon PowerPoint : console **régie**
      (image courante + **suivante** + **notes** locales par image + **chrono** total/par-image,
      pause/reset) pilotant une **fenêtre public** plein écran (l'image seule, sans chrome,
      curseur masqué) via **`BroadcastChannel`** (position synchronisée dans les deux sens).
      Placement **auto** sur le 2e écran (Multi-Screen Window Placement API, Chrome/Edge),
      sinon popup à glisser + plein écran. La fenêtre public **précharge ses propres blobs**
      (les object URLs ne traversent pas les fenêtres). Notes en `localStorage` (aucune base).
      Réalisé en phases : A (régie + fenêtre synchronisées), B (notes + chrono), D (finitions
      + docs). **Phase C (parité invité) volontairement non faite.**
