# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — build : compile le bundle statique React/Vite.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN npm ci --workspace client --include-workspace-root

COPY client/ client/

# Le client n'appelle jamais le backend en absolu (voir vite.config.ts) :
# aucune variable d'environnement n'est nécessaire au build.
RUN npm run build --workspace client

# ---------------------------------------------------------------------------
# Stage 2 — runtime : nginx sert le build et fait reverse-proxy vers l'API.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
# --chmod force des permissions lisibles par tous : sans ça, les fichiers
# copiés depuis le stage build peuvent hériter de permissions trop
# restrictives et nginx (processus non-root sur cette image) reçoit un 403
# en tentant de les lire.
COPY --from=build --chmod=755 /app/client/dist /usr/share/nginx/html

EXPOSE 80
