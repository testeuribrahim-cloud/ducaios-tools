# Image de l'outil web.fetch (décisions DucAiOs 0026 et 0036).
# Construite depuis la racine du dépôt (contexte « . ») par .github/workflows/image-web-fetch.yml,
# qui y pose les étiquettes org.opencontainers.image.* (révision, source, version, licence).
# Le conteneur tourne en lecture seule (/tmp seul en écriture), sans shell requis, en 65534:65534.

# 1. Construction : toutes les dépendances (npm ci), puis un seul fichier, dist/web-fetch.mjs.
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY tools/web-fetch/package.json tools/web-fetch/
RUN npm ci --no-audit --no-fund
COPY third_party/openclaw third_party/openclaw
COPY tools/web-fetch/build.mjs tools/web-fetch/tsconfig.json tools/web-fetch/
COPY tools/web-fetch/src tools/web-fetch/src
# Contrôle du fichier construit, sans réseau : une entrée vide est refusée (code 1, invalid_input).
RUN npm run build --workspace @ducaios-tools/web-fetch \
 && { printf '{}' | node tools/web-fetch/dist/web-fetch.mjs > /tmp/refus.json 2>/dev/null; [ $? -eq 1 ]; } \
 && grep -q '"code":"invalid_input"' /tmp/refus.json

# 2. Dépendances de production seulement (npm ci --omit=dev), sans le lien vers l'espace de travail
#    ni les dossiers vides que npm laisse pour les paquets de développement omis.
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production-deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY tools/web-fetch/package.json tools/web-fetch/
RUN npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/@ducaios-tools node_modules/.package-lock.json \
 && find node_modules -type d -empty -delete

# 3. Image finale : le fichier construit, les dépendances de production et les licences ; aucun outil de construction.
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /src/node_modules /app/node_modules
COPY --from=build /src/tools/web-fetch/dist/web-fetch.mjs /app/web-fetch.mjs
# Le code d'extraction repris d'OpenClaw (MIT) est dans web-fetch.mjs : sa licence l'accompagne.
COPY third_party/openclaw/LICENSE third_party/openclaw/PROVENANCE.json /app/licenses/openclaw/
USER 65534:65534
ENTRYPOINT ["node", "/app/web-fetch.mjs"]
