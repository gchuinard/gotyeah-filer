#!/bin/bash
# Déploiement de Filer sur le Pi. Ce script ne se lance pas à la main : il est
# exécuté par /usr/local/sbin/gotyeah-deploy (commande forcée de la clé
# SSH_KEY dans authorized_keys), depuis /home/pi/sites/gotyeah-filer, après un git fetch.
# Variables reçues : CIBLE (commit à déployer), AVANT (commit en place).
# Le script est lu dans le commit CIBLE : le modifier sur main suffit.
# Mêmes étapes que l'ancien script du workflow : avance rapide seulement, pas de
# retour arrière automatique.
set -euo pipefail

# Remplace « git pull --ff-only origin main » : le git fetch est déjà fait, CIBLE est
# origin/main.
git merge --ff-only "$CIBLE"

# `up --build` construit l'image avant de recréer le conteneur : l'ancien sert le site
# pendant tout le build. `--wait` attend ensuite que la sonde du compose passe au vert
# (plusieurs essais, cf. healthcheck) et fait échouer le déploiement sinon, au lieu d'un
# succès sur un conteneur mort. En cas d'échec, seul l'état des conteneurs est affiché :
# les journaux d'un dépôt public sont lisibles par tous, ceux de l'appli n'y vont pas.
docker compose up -d --build --wait --wait-timeout 120 || { docker compose ps -a; exit 1; }
docker image prune -f
