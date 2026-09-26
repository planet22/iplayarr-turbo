# syntax=docker/dockerfile:1

# Pinned to the current Node LTS (24, "Krypton") on the latest stable Alpine (3.24),
# instead of the previous floating node:current-alpine3.20 (which had already drifted
# to Node 24 anyway, just without anyone deciding that on purpose).
FROM node:24-alpine3.24 AS base
# python3/make/g++ are needed to compile the bcrypt native addon - Alpine's musl libc
# has no prebuilt binary for it, so this is required for both the dev and prod installs.
RUN apk add --no-cache python3 make g++

# ---- deps: full install (incl. devDependencies) for building backend + frontend ----
FROM base AS deps
WORKDIR /app
COPY package*.json ./
COPY frontend/package*.json ./frontend/
RUN npm run install:both

# ---- build: compile backend (tsc) and frontend (vue-cli-service) ----
FROM deps AS build
COPY . .
RUN npm run build:both

# ---- prod-deps: production-only backend node_modules for the runtime image ----
# Frontend has no runtime deps of its own - it ships as static files from the build
# stage - so this only ever installs the backend's package.json.
FROM base AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- redis: source of the bundled redis-server binary ----
FROM redis:8-alpine3.23 AS redis

# ---- runtime-base: everything the app needs to run, shared by both the dev and
# prod runtime images below - just not which node_modules yet, since that's the
# one thing that differs between them.
FROM node:24-alpine3.24 AS runtime-base

RUN apk --update add \
    ffmpeg \
    openssl \
    perl-mojolicious \
    perl-lwp-protocol-https \
    perl-xml-simple \
    perl-xml-libxml \
    su-exec \
    python3

# atomicparsley still isn't packaged in any stable Alpine release, only edge/testing,
# so it needs its own apk invocation - keeping --allow-untrusted scoped to just this
# command instead of the whole apk add above, so signature verification still applies
# to everything else.
RUN apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing --allow-untrusted atomicparsley && \
    ln -s "$(which atomicparsley)" /usr/local/bin/AtomicParsley

RUN mkdir -p /data/output /data/config /config /data /node-persist /app/frontend /logs

WORKDIR /iplayer

ENV GET_IPLAYER_VERSION=3.36

RUN wget -qO- https://github.com/get-iplayer/get_iplayer/archive/v${GET_IPLAYER_VERSION}.tar.gz | tar -xz -C /tmp && \
    mv /tmp/get_iplayer-${GET_IPLAYER_VERSION}/get_iplayer . && \
    rm -rf /tmp/* && \
    chmod +x ./get_iplayer

ENV GET_IPLAYER_EXEC=/iplayer/get_iplayer
ENV STORAGE_LOCATION=/node-persist
ENV CACHE_LOCATION=/data

WORKDIR /ytdlp

RUN wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && \
    chmod +x ./yt-dlp

ENV YTDLP_EXEC=/ytdlp/yt-dlp

# Copy Redis binary from the Redis Alpine image
WORKDIR /redis
COPY --from=redis /usr/local/bin/redis-server /redis/redis-server
RUN chmod +x /redis/redis-server

# Install iplayarr - the built output makes it into this image either way; src/ and
# frontend/src/ stay behind in the build stages regardless of which node_modules gets
# layered on below (a `rm -rf` after COPY . . couldn't achieve this: it hides files
# from a later layer, but earlier layers - and the image size that comes with them -
# are unaffected).
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package*.json ./
COPY docker_entry.sh ./

ENV LOG_DIR=/logs

ENTRYPOINT [ "./docker_entry.sh" ]

# ---- dev: full (incl. devDependencies) node_modules, for local hot-reload work -
# only ever selected explicitly via `target: dev` (the personal docker-compose.yaml),
# never the default build target, so a plain build can't accidentally ship this.
FROM runtime-base AS dev
COPY --from=deps /app/node_modules ./node_modules
CMD ["npm", "run", "serve:backend"]

# ---- runtime: production-only node_modules. This is the last stage in the file, so
# it's what gets built whenever nothing specifies --target/target: - the published
# image and docker-compose.prod.yaml included.
FROM runtime-base AS runtime
COPY --from=prod-deps /app/node_modules ./node_modules
CMD ["npm", "run", "start"]
