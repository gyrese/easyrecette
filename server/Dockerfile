# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build : compile TypeScript et génère le client Prisma.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Le monorepo utilise des workspaces npm : on copie les manifests d'abord
# pour profiter du cache Docker tant que les dépendances ne changent pas.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN npm ci --workspace server --include-workspace-root

COPY server/prisma server/prisma
COPY server/tsconfig.json server/tsconfig.json
COPY server/src server/src

RUN npm run db:generate --workspace server
RUN npm run build --workspace server

# `npm prune --omit=dev` retirerait aussi le CLI `prisma`, utilisé au
# démarrage du conteneur pour synchroniser le schéma (`prisma db push`) ;
# on le garde donc explicitement en le retirant de devDependencies avant
# de pruner, ce qui le fait traiter comme une dépendance de production.
RUN node -e "const fs=require('fs');const p='server/package.json';const j=JSON.parse(fs.readFileSync(p));j.dependencies.prisma=j.devDependencies.prisma;fs.writeFileSync(p,JSON.stringify(j,null,2));"
RUN npm prune --workspace server --omit=dev

# ---------------------------------------------------------------------------
# Stage 2 — runtime : image légère avec yt-dlp + ffmpeg (équivalents Linux
# des outils facultatifs utilisés en développement sous Windows).
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       ffmpeg \
       curl \
       ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Utilisateur non-root : bonne pratique pour un service exposé sur un VPS.
RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/package.json ./server/package.json

# Dossiers persistés par volume (voir docker-compose.yml). La base SQLite vit
# dans /app/server/data — volontairement séparée de prisma/ (qui contient le
# schéma livré avec l'image) pour qu'un volume monté dessus ne le masque pas.
RUN mkdir -p /app/server/data /app/server/media \
    && chown -R app:app /app

USER app
WORKDIR /app/server

EXPOSE 4000

# db push avant démarrage : crée/synchronise le fichier SQLite sur le volume
# monté s'il n'existe pas encore (équivalent conteneurisé de `npm run db:push`).
CMD ["sh", "-c", "node_modules/.bin/prisma db push --skip-generate && node dist/index.js"]
