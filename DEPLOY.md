# Déploiement Docker sur VPS

EasyRecette tourne en trois conteneurs :

| Conteneur | Rôle |
| --- | --- |
| `server` | API Node/Express + Prisma (SQLite), yt-dlp et ffmpeg installés dedans |
| `client` | Nginx servant le build React et reverse-proxy vers `server` |
| — | Deux volumes Docker nommés (`db`, `media`) pour les données persistantes |

Le pipeline : `git push` sur `main` → GitHub Actions build les deux images →
push sur GitHub Container Registry (`ghcr.io`) → connexion SSH au VPS → pull
des nouvelles images → `docker compose up -d`.

---

## 1. Prérequis sur le VPS

```bash
curl -fsSL https://get.docker.com | sh   # installe Docker + le plugin compose
sudo usermod -aG docker $USER            # puis se reconnecter
```

Cloner le dépôt sur le VPS (seul `docker-compose.prod.yml` y sera réellement
utilisé, mais `git pull` est le moyen le plus simple de le garder à jour) :

```bash
git clone https://github.com/gyrese/easyrecette.git
cd easyrecette
```

Créer le fichier d'environnement de production **directement sur le VPS**
(il n'est jamais commité — voir `.gitignore`) :

```bash
cp server/.env.example server/.env
```

Puis éditer `server/.env` sur le VPS :

- `CORS_ORIGIN` → le domaine public réel, ex. `https://easyrecette.mondomaine.fr`
  (le navigateur envoie ce domaine comme `Origin`, même si tout passe par le
  même nginx — CORS le vérifie quand même).
- Au moins une clé IA (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY` ou `OPENAI_API_KEY`).
- `DATABASE_URL` et `NODE_ENV` sont **déjà fixés** dans `docker-compose.prod.yml`
  et n'ont pas besoin d'être définis dans `.env` (une valeur y serait ignorée).

⚠️ Sur le VPS, ce fichier doit s'appeler `server/.env` (chemin lu par
`docker-compose.prod.yml`) — pas `.env.deploy`, qui est généré automatiquement
par le workflow à chaque déploiement et ne contient que les tags d'image.

---

## 2. Rendre les images GHCR accessibles au VPS

Les images poussées sur `ghcr.io` sont **privées** par défaut. Deux options :

- **Simple** : dans GitHub → onglet *Packages* du dépôt → pour
  `easyrecette-server` et `easyrecette-client` → *Package settings* → *Change
  visibility* → **Public**. Le VPS peut alors `docker pull` sans authentification
  et l'étape `docker login` du workflow devient superflue (laisse-la, elle ne
  gêne pas si le token a les bons droits).
- **Privé** : garder les images privées et fournir un token d'accès en
  lecture seule au VPS (secret `GHCR_PULL_TOKEN`, voir section suivante).

---

## 3. Secrets GitHub Actions à configurer

Dans **Settings → Secrets and variables → Actions** du dépôt
`gyrese/easyrecette` :

| Secret | Valeur |
| --- | --- |
| `VPS_HOST` | IP ou domaine du VPS |
| `VPS_USER` | utilisateur SSH (ex. `deploy`) |
| `VPS_SSH_KEY` | clé privée SSH dédiée (voir ci-dessous) |
| `VPS_PORT` | port SSH, si différent de 22 (optionnel) |
| `VPS_DEPLOY_PATH` | chemin absolu du clone sur le VPS, ex. `/home/deploy/easyrecette` |
| `GHCR_PULL_TOKEN` | Personal Access Token (`read:packages`) — **uniquement si les images restent privées** |

Générer une clé SSH dédiée au déploiement (ne pas réutiliser ta clé perso) :

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
# Copier la clé PUBLIQUE sur le VPS :
ssh-copy-id -i deploy_key.pub deploy@VOTRE_IP
# Coller le contenu de deploy_key (clé PRIVÉE) dans le secret VPS_SSH_KEY
```

`GITHUB_TOKEN` (utilisé pour push sur GHCR) est fourni automatiquement par
GitHub Actions — rien à configurer.

---

## 4. Premier déploiement

```bash
git push origin main
```

Suit la progression dans l'onglet **Actions** du dépôt. Le workflow :

1. build les images `server` et `client` ;
2. les pousse sur `ghcr.io/gyrese/easyrecette-server` et `-client` ;
3. se connecte en SSH au VPS, tire les images, relance les conteneurs.

Au premier démarrage, le conteneur `server` exécute automatiquement
`prisma db push` pour créer le fichier SQLite sur le volume `db` — aucune
étape manuelle de migration n'est nécessaire.

Vérifier que tout tourne :

```bash
ssh deploy@VOTRE_IP
cd easyrecette
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f server
curl -f http://localhost/api/health
```

---

## 5. HTTPS

Ce setup expose le conteneur `client` (nginx) directement sur le port `80` du
VPS. Pour HTTPS, la manière la plus simple est d'ajouter **Caddy** ou
**nginx + certbot** en frontal, ou d'utiliser un reverse proxy déjà présent sur
le VPS (Traefik, etc.) pointant vers `client:80`. Si tu as déjà un reverse
proxy sur le VPS, retire la section `ports:` de `client` dans
`docker-compose.prod.yml` et rattache le conteneur au réseau de ce proxy à la
place — dis-le-moi si tu veux que je l'intègre.

---

## 6. Sauvegarde des données

Les données persistantes vivent dans deux volumes Docker nommés
(`easyrecette_db` et `easyrecette_media`), pas dans le dépôt. Sauvegarde
régulière recommandée :

```bash
docker run --rm -v easyrecette_db:/data -v $(pwd):/backup alpine \
  tar czf /backup/db-backup-$(date +%Y%m%d).tar.gz -C /data .
```

---

## 7. Développement local avec Docker (optionnel)

Le fichier `docker-compose.yml` (à la racine, distinct de
`docker-compose.prod.yml`) build les images localement à partir du code
source — utile pour vérifier que tout compile avant de pousser :

```bash
cp server/.env.example server/.env   # renseigner au moins une clé IA
docker compose up --build
```

Ouvre <http://localhost>.
