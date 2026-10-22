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
      (les object URLs ne traversent pas les fenêtres). Notes **par fichier en base**
      (colonne `files.note`, éditables en présentateur ET dans l'explorateur ; pas sur l'écran public).
      Réalisé en phases : A (régie + fenêtre synchronisées), B (notes + chrono), D (finitions
      + docs). **Phase C (parité invité) volontairement non faite.**
- [x] **Retours « épreuve du feu » (1er gala)** — deux irritants corrigés :
      1. **Plein écran public en un clic** : toute la fenêtre public est cliquable (overlay
         plein cadre + message central) → plus besoin de viser un petit bouton à l'aveugle
         sur le projecteur ; la régie `focus()` la fenêtre pour que la touche F marche aussi.
      2. **Retouche accessible depuis la régie** : bouton « Retoucher » sur l'aperçu → ouvre
         l'`ImageEditor` existant en modale (z-[80] > régie z-[70]) ; « Enregistrer sous… »
         crée une **copie** sans changer l'image projetée ; clavier régie neutralisé pendant
         l'édition (prop `paused`).
- [x] **Retouche : aperçu live projeté + « Écraser l'original »** (suite des retours gala) :
      1. **Aperçu LIVE en présentateur** : en bougeant les sliders, l'image **projetée** se met
         à jour en temps réel (filtre SVG diffusé à la fenêtre publique via `BroadcastChannel`).
         Math mutualisée dans `src/lib/image-adjust.ts` + `src/components/adjust-filter.tsx`.
      2. **« Écraser l'original »** (en plus de « Enregistrer une copie ») : remplace
         définitivement le fichier via **`PUT /api/files/[id]`** (streaming temp+rename ;
         garde id/created_at/partages → l'image garde sa place). **Destructif**, donc derrière
         une **confirmation `useConfirm`** (passée en `z-[90]` pour rester au-dessus de la régie).
         Cache-bust (`reload`) pour rafraîchir projecteur/régie/explorateur (blobs préchargés figés).
      3. Disponible **partout** (explorateur + présentateur). Exception **assumée** à la règle
         « retouche non-destructive » : seul l'écrasement explicite et confirmé touche l'original.
- [x] **Télécommande mobile** (admin) : piloter la projection **depuis le téléphone** (◀ ▶,
      **écran noir**, vignette « suivante »). `BroadcastChannel` ne traversant pas les appareils →
      **relais serveur en mémoire** (SSE `GET /api/projection/stream` + `POST /api/projection/cmd`,
      protocole `src/lib/remote-protocol.ts`, relais `src/lib/projection-relay.ts`), **room** =
      code d'appairage 4 chiffres affiché par la régie ; page `/admin/remote`. Le téléphone pilote
      la régie, qui mène l'écran public (nouveau message `black` + touche **B**). En-têtes SSE
      anti-buffering pour NPM/Cloudflare (repli polling possible si bufferisé). **SSE validé en prod.**
- [x] **Télécommande : notes + chrono** (mode présentateur de poche). Sur le téléphone :
      **note** de l'image courante **éditable** (persistée en base via commande `note` →
      `onNoteById` → `useFileNotes` ; optimiste + debounce + flush) et **chrono** affiché +
      **pilotable** (pause/reprise/reset). Chrono **sorti dans un hook** `src/lib/use-presenter-timer.ts`
      (horloges sans tick ; `PresenterTimer` présentationnel) ; la régie pousse un **instantané**
      que le téléphone **extrapole** (anti-décalage d'horloge), commande `timer`.
- [x] **Télécommande : retouche live depuis le téléphone**. Sliders sur le tél (aperçu local) →
      réglage diffusé en continu (throttlé ~120 ms, commande `adjust`) → la régie le **rediffuse**
      au public → **aperçu projeté en temps réel** (réutilise le filtre live existant). « Écraser
      l'original » (confirmé sur le tél, commande `retouch`) → **la régie fait le rendu canvas +
      `PUT`** (`renderAdjusted`/`overwriteMime` extraits dans `src/lib/render-adjusted.ts`,
      mutualisés) puis rafraîchit projecteur/régie/explorateur. Le tél ne fait que piloter (calcul
      lourd sur le laptop). Pas d'éditeur de retouche complet sur le tél.
- [x] **Télécommande : repli polling (résilience reconnexion)**. Bug : le flux SSE entrant
      du tél peut se figer (veille/bascule réseau) alors que les commandes (POST) passent →
      affichage gelé (« suivante »/position/chrono). Fix : le relais **mémorise le dernier état**
      par room (`getLastState`/`setLastState`), exposé par **`GET /api/projection/state`** ; le tél
      le **poll (~2,5 s) tant que son SSE n'est pas `open`** (`applyState` factorisé) → l'affichage
      se remet à jour même SSE coincé ; temps réel repris au retour du SSE.
      Durcissements (revue) : `lastState` borné (plafond LRU ~50), `GET /state` en **204** si
      vide, et ré-ancrage du chrono **seulement si l'instantané change** (plus de saut arrière).
- [x] **Télécommande : durcissement liveness + accusé de réception** (audit multi-angles).
      Le repli polling ne couvrait que la coupure FRANCHE (`onerror`) ; un SSE « **figé mais
      ouvert** » (veille mobile, bascule réseau, socket proxy demi-ouverte) ne déclenchait pas
      `onerror` → polling jamais armé, et la **régie sourde en silence**. Livré en 3 phases :
      **(1) Liveness** — keep-alive en vrai message `data:{type:"ping"}` (15 s), **watchdog**
      `lastMsgRef` (silence > 35 s → `stale` + reconnexion forcée) sur le tél ET la régie, repli
      armé aussi sur `stale`, régie dotée d'`onerror`/indicateur/heartbeat d'état (~10 s), resync
      sur `visibilitychange`/`online`, pastille verte seulement si réellement vivant.
      **(2) Quick-wins** — Wake Lock écran, `AbortSignal.timeout` + garde `inFlight` (anti-fetch
      zombies), `no-store` (polling + 204), directive SSE `retry: 2000`.
      **(3) Accusé `seq`/`ackSeq`** — commandes numérotées, `ackSeq` renvoyé dans l'état (push
      forcé via `ackTick`), bandeau « commande non confirmée » + réémission des commandes
      idempotentes au retour de connexion ; navigation en `goto` **absolu** (plus de double-saut),
      resync du compteur sur l'`ackSeq` (robuste au reload du tél). Redis/multi-instance écartés.
- [x] **Remote : affichage image actuelle + suivante + mise en page compacte**. La
      télécommande montre désormais l'image **actuelle** À CÔTÉ de la suivante (boîtes 4/3,
      overlay « écran noir » sur l'actuelle si le noir est actif), chrono sur une ligne,
      note réduite, paddings/boutons resserrés → prend nettement moins de place.
- [x] **Avance auto par image (mode présentateur)**. Durée par image (colonne `files.advance_ms`,
      `PATCH … { advanceMs }`, hook `useFileAdvance` calqué sur les notes), éditable dans
      l'explorateur ET la régie (saisie en secondes). En présentation (écran public ouvert),
      l'image passe à la suivante une fois le délai **passé sur l'image** écoulé : réutilise le
      chrono « image » (`usePresenterTimer.slide`) → respecte la pause + reset par image ;
      `setTimeout` sur le restant (pas de polling) ; `restartSlide` à l'ouverture du public
      (pas de saut de la 1ʳᵉ image) ; stop à la dernière (pas de boucle).
      **Décompte** affiché dans la régie (composant isolé `AutoAdvanceCountdown` qui tique
      sans re-rendre la régie) — sous le champ ET en overlay sur l'aperçu.
- [x] **Avance auto + décompte sur la télécommande** (parité). Le téléphone peut **régler**
      l'avance auto de l'image courante (commande `advance { id, ms }` → `onAdvanceMsById` →
      `setAdvance` ; optimiste + debounce + **flush au changement d'image/démontage**, qui
      corrige au passage le même cas latent sur la note) et **voir le décompte** (« ⏱ … »)
      extrapolé localement, affiché uniquement si l'auto-avance est armée (la régie pousse
      `advanceMs` + `advanceActive` dans `RemoteState`). Revue adversariale 2 angles → 1 défaut
      (slot d'attente unique) corrigé.
- [x] **Gros fichiers (jusqu'à 100 Go) : upload par morceaux + téléchargement reprenable**
      (3 phases avec gate, branche `feat/gros-fichiers`). Constat : un fichier envoyé d'un bloc
      bute sur Cloudflare (100 Mo), NPM (25 Mo hors dérogation) et le `requestTimeout` de Node
      (300 s, mesuré : 408 à 300,1 s) — `MAX_UPLOAD_MB` seul n'y pouvait rien.
      **(1) Serveur** — sessions `/api/upload/sessions` : morceaux de 16 Mio ajoutés à un
      `.part` sous `/data/uploads`, position = taille réelle du partiel, verrou par session,
      finalisation transactionnelle idempotente, purge 6 h, contrôle de place disque sérialisé.
      Harnais 13 scénarios dont 5 Gio (> 2³²) à SHA-256 identique malgré abandon en plein
      morceau et 2 redémarrages serveur. Revue adversariale → 1 défaut (surréservation disque
      par ouvertures simultanées) corrigé.
      **(2) Client** — file hors React (l'envoi survit au changement de vue), bandeau header
      (progression + échecs), reprise auto (backoff, chien de garde, relecture de la position),
      popup natif avant fermeture + bandeau explicite, `DELETE` keepalive au départ de la page,
      Wake Lock, déconnexion confirmée, liens `download` + zip en iframe pendant un envoi.
      Vérifié en navigateur (build prod) : coupure serveur → reprise sans rechargement,
      `window.stop()` → reprise. Revue adversariale → 7 défauts corrigés.
      **(3) Téléchargement** — `Range`/`If-Range`/ETag fort sur l'attachment (reprise `curl -C -`
      d'un 5 Gio à SHA-256 identique, compté une fois), `HEAD` explicite (plus de fuite de
      descripteur ni de comptage), `no-transform` + `X-Accel-Buffering: no`, zip : entrées
      ≥ 64 Mio en deflate niveau 1 (ZIP64 OK ; d'abord stockées brutes, corrigé après revue :
      illisibles en flux par Java/Android `ZipInputStream`).
      **Passe de contrôle (22/10)** : envoi réel de 320 Mio en prod à travers Cloudflare + NPM
      (20 × 16 Mio en 200, retéléchargement identique, Range/If-Range/HEAD, compteur = 1) ;
      débit montant mesuré ~5,5 Mio/s (box). Revue adversariale Phase 3 → zip corrigé, et un
      bug ANTÉRIEUR révélé : aperçus PDF blancs (`X-Frame-Options: DENY` + CSP NPM
      `frame-ancestors 'none'`) → `SAMEORIGIN` / `'self'`.
      **Ops** : `MAX_UPLOAD_MB=102400` dans le `.env` du Pi AVANT le déploiement ; vérifier la
      place disque ; exclure `/data/uploads` des sauvegardes ; ne pas déployer pendant un envoi.
      **Débit (22/10)** : upload via Cloudflare plafonné à 6 Mio/s — cause : NPM
      `proxy_request_buffering off` sur `/api/upload` + HTTP/2 Cloudflare→nginx (petite
      fenêtre par aller-retour). Passé à `on` → 35-44 Mio/s. CSP déplacée dans l'app
      (`next.config.ts`, prod), retirée de la Custom Location `/` de NPM.
- [x] **Lien public** (partage sans e-mail, branche `feat/lien-public`). Un partage de fichier
      OU de dossier peut être créé « public » : `/s/<token>` s'ouvre sans saisir d'e-mail (la
      Route Handler `/s/<token>/entrer` pose la même session invité que la porte), durée 1 / 7
      (défaut) / 30 jours ou sans expiration, vérifiée partout (`getActiveShare`), révocable,
      pages `noindex`. UI : bloc « Lien public » (durée + « Créer et copier le lien ») dans la
      fenêtre Partager. Colonnes `shares.public` / `shares.expires_at` ajoutées au boot.
      30 tests curl (entrée, Range, cloisonnement, cookies bloqués, admin préservé, expiration,
      révocation, dossier + zip, partage e-mail inchangé).
- [x] **Upload parallèle** (branche `feat/upload-parallele`). Constat : depuis Chrome, l'envoi
      plafonnait à ~13-15 Mio/s via Cloudflare, qui reçoit chaque morceau EN ENTIER avant de le
      transmettre — en séquentiel ces attentes s'additionnent. Mode **parallèle** à côté du
      séquentiel (gardé pour un onglet chargé avant la mise à jour) : morceaux **numérotés**
      (`x-upload-chunk`) écrits à leur place, 4 en vol par fichier, 8 au total ; table
      `upload_chunks` (reçus en entier) + colonne `uploads.chunk_size`, registre des écritures en
      cours au lieu du verrou, finalisation par le dernier morceau noté. Harnais (petit, 2 Gio,
      redémarrages serveur en plein envoi et pendant la finalisation) et navigateur (coupure →
      « reconnexion » seulement quand toutes les voies attendent → reprise, SHA-256 identique).
      Mesures prod depuis le PC (Node, sessions de test) : 1 flux 21-45 Mio/s, 4-8 flux
      25-86 Mio/s (très variable) ; téléchargement ~96 Mio/s sur un flux. Relecture puis revue
      multi-agents (4 angles + vérification adverse) → 16 défauts, tous corrigés, dont : durabilité
      sur coupure de courant (`datasync` par morceau, `fsync` + `synchronous = FULL` à la
      finalisation, reprise d'une finalisation interrompue), « Réessayer » bloqué à 100 % après
      une finalisation en échec, erreur terminale qui n'arrêtait pas les autres voies, lots de
      petits fichiers moins parallèles qu'avant, retour arrière du serveur mal signalé.
