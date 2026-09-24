# Déploiement Docker sur VPS

EasyRecette tourne en trois conteneurs :

| Conteneur | Rôle |
| --- | --- |
| `server` | API Node/Express + Prisma (SQLite), yt-dlp et ffmpeg installés dedans |
| `client` | Nginx servant le build React et reverse-proxy vers `server` |
| — | Deux volumes Docker nommés (`db`, `media`) pour les données persistantes |

Le pipeline : `git push` sur `main` → GitHub Actions build les deux images →
push sur GitHub Container Registry (`ghcr.io`) sous les tags `latest` et
`<sha court>`. Le déploiement sur le VPS reste **manuel** : tu te connectes en
SSH et tires les nouvelles images quand tu es prêt, comme sur tes autres
projets.

---

## 1. Prérequis sur le VPS (une seule fois)

```bash
curl -fsSL https://get.docker.com | sh   # installe Docker + le plugin compose
sudo usermod -aG docker $USER            # puis se reconnecter
```

Cloner le dépôt (seul `docker-compose.prod.yml` y est réellement utilisé,
mais `git pull` est le moyen le plus simple de le garder à jour s'il évolue) :

```bash
git clone https://github.com/gyrese/easyrecette.git
cd easyrecette
```

Créer le fichier d'environnement de production **directement sur le VPS**
(il n'est jamais commité — voir `.gitignore`) :

```bash
cp server/.env.example server/.env
nano server/.env
```

À éditer dans `server/.env` :

- `CORS_ORIGIN` → le domaine public réel, ex. `https://easyrecette.mondomaine.fr`
  (ou `http://IP_DU_VPS` sans domaine).
- Au moins une clé IA (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY` ou `OPENAI_API_KEY`).
- **Connexion Google** — obligatoire pour que les comptes fonctionnent :
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_SERVER_URL`,
  `PUBLIC_APP_URL` (voir la section suivante).
- **`SESSION_SECRET`** — obligatoire en production, le serveur refuse de
  démarrer sans lui. À générer **une seule fois** et à conserver : le changer
  déconnecte tout le monde.
  ```bash
  node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
  ```
- `DATABASE_URL` et `NODE_ENV` sont **déjà fixés** dans `docker-compose.prod.yml`
  et n'ont pas besoin d'être définis ici (une valeur y serait ignorée).

### Configurer la connexion Google

Sans ces clés, le serveur démarre mais la connexion est indisponible — et avec
elle tout ce qui touche au fichier personnel (import, recettes, courses). Seule
la page Découvrir reste consultable.

1. [console.cloud.google.com](https://console.cloud.google.com) → créer ou
   choisir un projet.
2. **APIs & Services → OAuth consent screen** : type « External », renseigner
   le nom de l'application et l'e-mail de contact. Tant que l'écran est en mode
   « Testing », seuls les comptes ajoutés dans **Test users** peuvent se
   connecter — passer en « Published » pour ouvrir à tous.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
4. Dans **Authorized redirect URIs**, coller l'adresse **exacte** (Google
   compare caractère par caractère, le `https` et l'absence de `/` final
   comptent) :
   ```
   https://easyrecette.mondomaine.fr/api/auth/google/callback
   ```
5. Reporter les valeurs dans `server/.env` :
   ```bash
   GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
   PUBLIC_SERVER_URL="https://easyrecette.mondomaine.fr"
   PUBLIC_APP_URL="https://easyrecette.mondomaine.fr"
   SESSION_SECRET=<la valeur générée plus haut>
   ```

En production, `PUBLIC_SERVER_URL` et `PUBLIC_APP_URL` sont identiques : nginx
sert le front et proxifie `/api` vers le serveur sur le même domaine. Elles ne
diffèrent qu'en développement (`:4000` et `:5173`).

Le cookie de session est posé avec `secure` dès que `NODE_ENV=production` : le
site **doit** être servi en HTTPS, sinon le navigateur refuse le cookie et la
connexion échoue sans message clair. Si tu déploies derrière un reverse proxy
TLS (Caddy, Traefik, nginx avec Let's Encrypt), rien de plus à faire.

### Première connexion et reprise des recettes existantes

Si la base contient déjà des recettes créées avant l'authentification (compte
technique `local@cookbook.app`), le **premier** utilisateur qui se connecte en
hérite : ses recettes deviennent les siennes, et restent privées. Les suivants
démarrent sur un fichier vide.

Connecte-toi donc en premier avec ton propre compte Google avant d'ouvrir le
site à d'autres — sinon c'est le premier arrivé qui récupère la bibliothèque.

### Rendre les images GHCR accessibles

Les images poussées sur `ghcr.io` sont **privées** par défaut. Le plus simple :
GitHub → repo `easyrecette` → onglet **Packages** → pour `easyrecette-server`
et `easyrecette-client` → **Package settings** → **Change visibility** →
**Public**. Le VPS peut alors `docker pull` sans authentification.

Pour garder les images privées à la place, s'authentifier une fois sur le VPS
avec un Personal Access Token GitHub (`read:packages`) :

```bash
echo "<TON_TOKEN>" | docker login ghcr.io -u gyrese --password-stdin
```

---

## 2. Déployer

```bash
ssh <user>@<IP_DU_VPS>
cd easyrecette
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Au premier démarrage, le conteneur `server` exécute automatiquement
`prisma db push` pour créer le fichier SQLite sur le volume `db` — aucune
étape manuelle de migration n'est nécessaire.

Vérifier que tout tourne :

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f server
curl -f http://localhost/api/health
```

### Redéployer après un nouveau push

Une fois que le workflow GitHub Actions a fini de builder (onglet **Actions**
du repo), relance simplement :

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker image prune -f   # optionnel, nettoie les anciennes couches d'image
```

---

## 3. HTTPS

Ce setup expose le conteneur `client` (nginx) directement sur le port `80` du
VPS. Pour HTTPS, la manière la plus simple est d'ajouter **Caddy** ou
**nginx + certbot** en frontal, ou d'utiliser un reverse proxy déjà présent sur
le VPS (Traefik, etc.) pointant vers `client:80`. Si tu as déjà un reverse
proxy sur le VPS, retire la section `ports:` de `client` dans
`docker-compose.prod.yml` et rattache le conteneur au réseau de ce proxy à la
place — dis-le-moi si tu veux que je l'intègre.

---

## 4. Sauvegarde des données

Les données persistantes vivent dans deux volumes Docker nommés
(`easyrecette_db` et `easyrecette_media`), pas dans le dépôt. Sauvegarde
régulière recommandée :

```bash
docker run --rm -v easyrecette_db:/data -v $(pwd):/backup alpine \
  tar czf /backup/db-backup-$(date +%Y%m%d).tar.gz -C /data .
```

---

## 5. Développement local avec Docker (optionnel)

Le fichier `docker-compose.yml` (à la racine, distinct de
`docker-compose.prod.yml`) build les images localement à partir du code
source — utile pour vérifier que tout compile avant de pousser :

```bash
cp server/.env.example server/.env   # renseigner au moins une clé IA
docker compose up --build
```

Ouvre <http://localhost>.
