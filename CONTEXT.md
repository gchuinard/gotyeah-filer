# Projet « Filer »

- **Quoi** : petit service perso d'auto-hébergement de partage de fichiers, pour remplacer WeTransfer / Grosfichiers dans un cadre familial. On dépose des fichiers (photos, bandes-son de spectacle — rien d'énorme), puis on les partage à des proches via un lien.
- **Domaine** : filer.gautierchuinard.com
- **Hébergement** : homelab perso — Raspberry Pi 5, Docker, Nginx Proxy Manager, Cloudflare en Full (Strict).

## Objectifs

- Léger, sobre, mobile-first (la famille consulte surtout au téléphone).
- Friction minimale côté invités.

## Modèle d'accès (le cœur du projet) — et son compromis assumé

La « connexion » est une **simple porte**, PAS une vraie authentification, et c'est **assumé / volontaire**. On saisit une adresse mail, on la compare à une liste, et si elle y figure on pose un cookie de session. Aucune preuve de possession de l'email n'est demandée.

- **Admins** : emails listés dans `ADMIN_EMAILS` (`.env`) → session admin, accès total.
- **Invités** : accèdent via un lien `/s/{token}`, saisissent leur mail ; si le mail figure dans la liste autorisée **de ce partage** (ou si admin) → accès au seul fichier de ce partage (consultation + download). Sinon refus.
- **Sessions** : cookie signé, httpOnly (secret `SESSION_SECRET`), contenant email + rôle (+ token de partage pour un invité). Stateless, aucun stockage en base. Durée longue (~30 jours).

**Compromis de sécurité** : faible et intentionnel. N'importe qui connaissant un mail autorisé peut se faire passer pour son propriétaire — il n'y a aucune vérification. C'est acceptable ici : usage strictement familial, périmètre réduit, et les liens de partage sont distribués à la main à des personnes de confiance. Le secret réel d'un partage, c'est son token (l'URL `/s/{token}`), pas le mail.

## Ce qui est volontairement EXCLU (non-objectifs)

- Pas de comptes / mots de passe / inscription.
- Pas de magic link — **l'app n'envoie AUCUN email** (pas de SMTP, pas de Brevo). Les liens sont distribués à la main, hors app (WhatsApp, SMS).
- Pas de scan antivirus.
- Pas d'ORM lourd ni de migrations.
- Pas de sur-ingénierie UI.

## Architecture (vue d'ensemble)

- **Front / serveur** : Next.js 16 (App Router, TypeScript), Tailwind CSS v4, dark mode.
- **Persistance** : better-sqlite3 (un seul fichier `.db`, schéma créé au boot, pas de Prisma ni migrations).
- **Fichiers** : stockés sur le système de fichiers (volume Docker monté sur `/data` : `/data/files` pour les fichiers, le `.db` sous `/data`).
- **Uploads volumineux** : via Route Handler en streaming (PAS de Server Action, à cause de la limite ~1 Mo).
- **Déploiement** : image Docker multi-stage (output standalone), exposée via Nginx Proxy Manager, Cloudflare Full (Strict).

> **Attention** : le proxy Cloudflare limite le body à 100 Mo (plans Free/Pro). Pour dépasser 100 Mo, passer le sous-domaine en DNS-only (grey cloud) ou prévoir un upload chunké.
