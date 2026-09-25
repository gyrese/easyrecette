# CookBook

Colle un lien TikTok, Instagram, YouTube ou un article de blog, et obtiens une
fiche recette structurée dans ta bibliothèque.

---

## Démarrage

```bash
npm install
cp server/.env.example server/.env   # puis renseigne au moins une clé d'IA
npm run db:push                      # crée la base SQLite
npm run db:seed                      # deux recettes de démonstration
npm run dev                          # API sur :4000, interface sur :5173
```

Ouvre <http://localhost:5173>.

Crée ton compte avec une adresse e-mail et un mot de passe depuis la page de
connexion. La connexion Google est une option supplémentaire (voir ci-dessous).

### Clés d'API

L'application démarre sans aucune clé. Dans ce cas :

- l'ajout manuel de recettes fonctionne ;
- l'import d'une page contenant déjà une recette structurée (Schema.org /
  JSON-LD — la plupart des grands sites de cuisine) fonctionne aussi, sans IA ;
- l'import d'une vidéo ou d'un texte libre renvoie une erreur explicite.

Pour activer la génération IA, renseigne **au moins une** de ces clés dans
`server/.env` :

| Variable | Fournisseur | Où l'obtenir |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude | console.anthropic.com |
| `GEMINI_API_KEY` | Gemini | aistudio.google.com/apikey — **requise pour l'analyse vidéo** |
| `OPENAI_API_KEY` | OpenAI | platform.openai.com |

`AI_PROVIDER` choisit lequel essayer en premier ; les autres servent de repli
automatique en cas de quota atteint ou de panne.

### Comptes

Chaque utilisateur a son propre fichier de recettes, privé par défaut. Deux
façons de se connecter, cumulables sur un même compte :

- **e-mail + mot de passe** — toujours disponible. Mots de passe hachés en
  scrypt, 8 caractères minimum. Il n'y a **pas d'envoi d'e-mail** : ni
  vérification d'adresse, ni « mot de passe oublié » pour l'instant ;
- **Google** — optionnel, activé dès que les clés ci-dessous sont renseignées.

Quand Google rattache un compte créé par e-mail, le mot de passe est effacé et
les sessions fermées. L'adresse n'ayant jamais été vérifiée à l'inscription,
c'est ce qui empêche un tiers d'inscrire ton adresse avant toi puis de
récupérer l'accès une fois que tu y as rangé tes recettes. Tu peux redéfinir un
mot de passe depuis la page compte.

#### Connexion Google (optionnelle)

```bash
# server/.env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PUBLIC_SERVER_URL="http://localhost:4000"
PUBLIC_APP_URL="http://localhost:5173"
```

Pour obtenir les deux clés : [console.cloud.google.com](https://console.cloud.google.com)
→ **APIs & Services → Credentials → Create credentials → OAuth client ID**,
type *Web application*. Dans **Authorized redirect URIs**, coller exactement :

```
http://localhost:4000/api/auth/google/callback
```

Tant que l'écran de consentement est en mode « Testing », seuls les comptes
listés dans **Test users** peuvent se connecter.

`SESSION_SECRET` peut rester vide en développement (un secret éphémère est tiré
au démarrage, donc les sessions ne survivent pas à un redémarrage). Il est
**obligatoire en production** — voir [DEPLOY.md](DEPLOY.md).

### Outils externes (facultatifs)

| Outil | Sert à | Sans lui |
| --- | --- | --- |
| `yt-dlp` | télécharger la vidéo à analyser | pas d'analyse visuelle, le reste fonctionne |
| `ffmpeg` | extraire la vignette de la vidéo | la fiche garde l'image de la plateforme |

Installation : `pip install yt-dlp` et [ffmpeg.org](https://ffmpeg.org/download.html).
Le chemin de yt-dlp peut être forcé avec `YTDLP_PATH` dans `.env`.

`YOUTUBE_API_KEY` est facultative : sans elle, l'import YouTube passe par
oEmbed et la page publique, ce qui suffit dans la plupart des cas.

---

## Ce que fait le produit

### Import

```text
URL collée → plateforme détectée → contenu récupéré → transcription si
disponible → analyse vidéo si nécessaire → génération →
prévisualisation éditable → enregistrement
```

### Analyse visuelle de la vidéo

Quand ni la légende ni les sous-titres ne contiennent la recette, l'app
**télécharge la vidéo et la regarde**. Le modèle relève le texte incrusté à
l'écran, ce qui est dit, et les gestes visibles.

Vérifié sur un Reel Facebook sans légende utile, sans sous-titres et **sans
voix off** : la recette a été reconstituée à partir des seuls gestes
(épluchage, mandoline, cuisson, dressage) → 14 ingrédients, 24 étapes, toutes
les quantités à `null` avec leur avertissement. L'absence de texte ne pousse
pas le modèle à inventer.

L'analyse ne se déclenche **qu'en dernier recours** : elle coûte environ huit
fois plus de tokens qu'une analyse de texte et prend une vingtaine de
secondes, contre trois pour un import ordinaire. Les liens dont la légende
suffit restent donc rapides et bon marché.

Elle nécessite `yt-dlp` (téléchargement) et `ffmpeg` (vignette), tous deux
facultatifs : sans eux, l'app se comporte comme avant et propose la saisie
manuelle. La vidéo n'est pas téléchargée quand le texte suffit.

### La vidéo reste dans la fiche

La vidéo d'origine est conservée localement (`server/media/`) et lisible
depuis la fiche recette. Deux raisons : une publication peut être supprimée
alors que la recette doit survivre, et certains gestes se comprennent mieux
en trois secondes d'image qu'en trois lignes de texte. Une vignette est
extraite pour illustrer la fiche quand la plateforme n'en fournit pas.

Compter ~6 Mo par recette importée avec sa vidéo. Les fichiers sont supprimés
avec la recette, et les imports abandonnés sont nettoyés au démarrage.

L'interface affiche l'état **réel** de chaque étape. Une étape qui n'a pas pu
se faire est marquée comme telle, avec sa raison — jamais présentée comme
réussie.

### La règle centrale

L'IA ne complète jamais une information absente de la source.

Corollaire de conception, appris en production : **une limite d'affichage ne
doit jamais invalider une donnée.** Les champs accessoires (avertissements,
conseils, tags, ustensiles, titre d'origine) sont tronqués quand ils dépassent
leur plafond, jamais rejetés. Sans cela, une recette très honnête — beaucoup
d'ingrédients sans quantité précise, donc beaucoup d'avertissements — était
refusée pour cette seule raison, dans 1 cas sur 2.

La génération est également retentée une fois par fournisseur avant d'échouer :
le modèle est stochastique, et un écart de forme ponctuel ne doit pas devenir
un échec visible.

| Source | Résultat |
| --- | --- |
| « deux cuillères de sauce soja » | `quantity: 2`, `unit: "c. à soupe"`, `ingredient: "sauce soja"` |
| « ajoutez du parmesan » | `quantity: null` + note « quantité non précisée » |
| « enfournez » (sans température) | `temperature: null` + warning « Température du four non précisée » |

Ces trois lignes ne sont pas des intentions : ce sont les sorties réelles
obtenues en test sur une transcription lacunaire (voir la section **État**).

Les avertissements sont affichés **au-dessus** de la fiche, pas en note de bas
de page : ce sont eux qui indiquent où porter son attention.

### Portions dynamiques

Changer le nombre de convives recalcule les quantités côté client, avec
conversion automatique (500 g pour 4 → 1 kg pour 8). Une quantité inconnue
reste inconnue quel que soit le multiplicateur.

### Comptes et partage

Chaque utilisateur a son fichier, invisible des autres. Une recette peut être
**partagée fiche par fiche** : elle apparaît alors sur la page Découvrir,
consultable par tout le monde, y compris sans compte.

Ce que le partage expose et ce qu'il n'expose pas :

| Partagé | Gardé privé |
| --- | --- |
| Ingrédients, étapes, matériel, conseils | Ta note et son commentaire d'essai |
| Durées, portions, catégorie, tags | Ton statut de favori |
| Provenance (plateforme, auteur d'origine) | Ta photo du plat, ton adresse e-mail |
| Ton nom d'auteur (ou « Anonyme ») | Tes autres recettes |

Le serveur retire les annotations personnelles au seul endroit qui construit
les réponses (`toDto`), pas au cas par cas dans chaque endpoint : aucun futur
endpoint ne peut donc les laisser fuir par oubli.

Un visiteur peut **enregistrer une copie** d'une fiche publique. La copie lui
appartient — modifiable, notable, et elle survit si l'auteur repasse
l'originale en privé. C'est un choix assumé : dépublier referme la porte, ça ne
reprend pas ce qui est déjà sorti. Le panneau de partage le dit explicitement
plutôt que de laisser croire à un retrait total.

Publier demande de confirmer sous quel nom ; dépublier est immédiat. L'asymétrie
est voulue : rendre une fiche publique est difficile à rattraper, la refermer ne
se négocie pas.

### Liste de courses

Les ingrédients identiques fusionnent — mais seulement si leurs unités sont
compatibles :

- `2 oignons` + `1 oignon` → **3 oignons**
- `500 g farine` + `700 g farine` → **1,2 kg farine**
- `200 g tomates` + `4 tomates` → **deux lignes** (additionner serait faux)

---

## Ce qui marche, et ce qui ne peut pas marcher

| Source | Texte | Sous-titres | Analyse vidéo |
| --- | --- | --- | --- |
| Site avec Schema.org Recipe | oui, **sans IA** | — | — |
| Blog / article | oui | — | — |
| Facebook | légende complète | oui (`.srt` en clair) | oui |
| YouTube | description | non (verrouillés) | oui |
| TikTok / Instagram | légende | non | oui |

L'analyse vidéo rattrape la plupart des cas où le texte manque. Les limites
ci-dessous portent donc sur les seules **sources textuelles** ; elles
expliquent pourquoi l'analyse visuelle existe.

**Limites de plateforme, pas des défauts d'implémentation.**

*YouTube — sous-titres.* Le code liste correctement les pistes de sous-titres
d'une vidéo, mais depuis 2025 YouTube lie leurs URL à la session et à l'IP du
navigateur qui a chargé la page. Un téléchargement depuis un serveur reçoit
`HTTP 200` avec un corps **vide** — vérifié en conditions réelles, sur tous les
formats (`json3`, `srv3`, `vtt`, `srv1`). L'application le signale explicitement
(« Sous-titres présents mais inaccessibles depuis un serveur ») plutôt que de
laisser croire à un bug ou à une vidéo sans sous-titres. Les contourner
demanderait l'API Data v3 avec OAuth (réservée au propriétaire de la chaîne) ou
un téléchargement audio puis transcription — deux chemins hors du périmètre
d'un import depuis une URL publique.

Conséquence pratique : une vidéo YouTube dont la description contient la recette
donne un bon résultat immédiat. Sinon, l'analyse visuelle prend le relais — la
recette est reconstituée depuis l'image, pas inventée.

*TikTok, Instagram, Facebook — audio.* Aucune de ces plateformes ne donne accès
à la piste audio par un moyen public et conforme à leurs CGU. La recette est
donc déduite de la légende.

**Facebook est une exception : ses sous-titres sont récupérables.** Contrairement
à YouTube, Facebook sert le fichier `.srt` d'une vidéo en clair depuis son CDN.
Quand une publication en a, l'app reconstitue donc la recette **dictée à
l'oral** — vérifié sur une vidéo dont la légende n'était qu'un titre et des
hashtags : 215 mots de sous-titres → 13 ingrédients, 6 étapes.

Les Reels demandent en plus deux contournements, constatés en conditions
réelles : `/reel/{id}` sans slash final renvoie 400, et Facebook ne sert les
métadonnées qu'à un User-Agent de crawler social. L'importer décline donc
chaque URL en ses formes équivalentes.

Trois cas, vérifiés sur de vraies publications Facebook :

- **La légende contient la recette** (fréquent chez les créateurs culinaires) →
  import complet. Exemple testé : 16 ingrédients, 9 étapes, confiance 0,9.
  `og:description` étant tronqué par Facebook, l'importer va chercher la
  légende intégrale dans les données embarquées de la page.
- **La légende est pauvre mais la vidéo a des sous-titres** → la recette est
  reconstituée depuis l'oral. C'est le cas le plus fréquent sur les vidéos de
  cuisine courtes.
- **Légende pauvre ET pas de sous-titres** () → la recette
  n'existe nulle part sous forme de texte. C'est exactement le cas que
  **l'analyse visuelle** traite : la vidéo est téléchargée et regardée. Si elle
  échoue aussi, l'app le dit et propose la saisie manuelle, au lieu de produire
  une fiche « 1 ingrédient, 1 étape » qui aurait l'air d'un succès.

Quand une source est inaccessible (publication privée, mur de connexion,
contenu supprimé), l'application le dit clairement et propose de **coller le
texte à la main**. C'est le chemin de secours prévu, pas un échec.

Certains sites (Allrecipes, Serious Eats…) bloquent les requêtes serveur par
anti-bot et renvoient 403. L'import échoue alors proprement, avec la saisie
manuelle en solution.

---

## Architecture

```text
server/
  prisma/schema.prisma        modèles + relations
  src/
    schemas/                  contrats Zod — source de vérité du format
    services/
      importers/              un adapter par plateforme, format de sortie commun
      recipeAI/               3 providers + conversion Schema.org sans IA
      importPipeline.ts       orchestration + journal d'étapes honnête
      shoppingList.ts         fusion des ingrédients
    database/                 repositories (les controllers ne voient pas Prisma)
    controllers/ routes/      HTTP
    utils/
      safeFetch.ts            protection SSRF
      units.ts                conversions, mise à l'échelle, fusion

client/
  src/
    pages/                    une page par route
    components/               briques d'interface
    lib/
      units.ts                copie de server/src/utils/units.ts
      types.ts                miroir des schémas Zod
```

### Ajouter une plateforme

Écrire un module dans `server/src/services/importers/` qui exporte un
`Importer`, puis l'enregistrer dans `importers/index.ts`. Aucun autre fichier
ne change.

### Passer à PostgreSQL

Le schéma n'utilise aucun type propre à SQLite. Il suffit de :

1. `provider = "postgresql"` dans `prisma/schema.prisma` ;
2. `DATABASE_URL` pointant vers Postgres ;
3. `npm run db:push`.

Les listes courtes (tags, conseils) sont stockées en JSON texte via
`utils/json.ts` — à convertir en `String[]` natif si on veut en profiter.

---

## Sécurité

- **SSRF** : schéma restreint à http/https, résolution DNS validée contre les
  plages privées et link-local (dont `169.254.169.254`), redirections suivies
  manuellement et revalidées à chaque saut, plafond d'octets en streaming,
  timeout par requête.
- **Rate limiting** : 10 imports/min (requêtes sortantes + appels IA payants),
  300 req/min pour le reste.
- **Validation** : toute entrée passe par Zod, y compris la sortie de l'IA.
- **Secrets** : uniquement côté serveur. Le client appelle `/api` en relatif ;
  aucune clé ni adresse de backend dans le bundle.
- **Sessions** : le cookie porte un jeton aléatoire de 32 octets ; la base n'en
  stocke que le SHA-256. Une fuite de la base ne donne donc aucune session
  utilisable. Cookie `httpOnly`, signé (HMAC), `sameSite=lax`, `secure` en
  production. Sessions révocables réellement (enregistrement en base plutôt
  qu'un JWT auto-porté), purgées à l'expiration.
- **Mots de passe** : scrypt (N=2^15), paramètres stockés avec le hash.
  Connexion : un seul message d'échec et un temps de réponse constant (hash
  factice pour les adresses inconnues) — ni le texte ni le chronomètre ne
  révèlent qui est inscrit. 10 échecs par quart d'heure et par IP, compteurs
  séparés pour la connexion, l'inscription et le changement de mot de passe.
  Changer son mot de passe ferme les sessions des autres appareils.
- **OAuth** : état anti-CSRF dans un cookie signé, comparé en temps constant.
  Le `id_token` de Google est validé côté serveur — audience, émetteur et
  adresse vérifiée contrôlés explicitement, jamais décodé en confiance.
  20 tentatives/min et par IP sur la connexion.
- **Cloisonnement** : toute requête sur une recette filtre par `userId` dans le
  `where` SQL. Une fiche privée d'autrui répond **404**, pas 403 : un 403
  confirmerait son existence à qui essaie des identifiants au hasard. Les
  routes sont déclarées protégées une par une dans `routes/index.ts`, jamais
  « ouvertes par défaut sauf exception ».

Limite connue : entre la validation DNS et la connexion TCP, un DNS rebinding
reste théoriquement possible. Le correctif serait un agent HTTP validant l'IP
au moment du `connect`.

---

## Scripts

| Commande             | Effet                                        |
| -------------------- | -------------------------------------------- |
| `npm run dev`        | API + interface en parallèle                 |
| `npm run build`      | Build de production des deux                 |
| `npm run typecheck`  | TypeScript strict sur les deux workspaces    |
| `npm test`           | Tests du module d'unités (22 cas)            |
| `npm run db:studio`  | Prisma Studio                                |

---

## État

Livré et vérifié : architecture, base, import web avec extraction Schema.org,
import manuel, bibliothèque avec recherche et filtres, fiche recette, mode
cuisine avec minuteur, portions dynamiques, liste de courses, PWA installable.

Non vérifié faute de clé d'API dans l'environnement de développement : le
chemin de génération IA (les trois adapters sont écrits et compilent, mais
n'ont pas été exécutés contre une vraie API).
