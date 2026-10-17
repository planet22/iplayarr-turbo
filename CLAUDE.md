# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

iPlayarr is a companion tool for Sonarr/Radarr that makes BBC iPlayer content searchable and downloadable through them. It presents itself over HTTP as two protocols simultaneously:

- A **Newznab-compatible indexer** (`?t=...` query param) — Sonarr/Radarr search it like a Usenet indexer.
- A **SABnzbd-compatible download client** (`?mode=...` query param) — Sonarr/Radarr queue/monitor "downloads" through it.

Underneath, it drives `get_iplayer` (Perl, bundled in the Docker image) and `yt-dlp` as the actual fetchers, and stores all state (config, queue, history, caches, sessions) in an embedded SQLite file via Prisma.

## Commands

The repo is an npm workspace: the root is the backend and `/frontend` is a workspace, sharing one `node_modules` and one `package-lock.json`.

```bash
npm install              # one install at the root covers backend + frontend (npm workspaces)
npm run dev                # run backend (nodemon) + frontend (vite dev server) concurrently, with DEBUG=true
npm run build:both         # build frontend workspace (vite build) + backend (tsc) for production
npm start                  # run the built backend (dist/src/server.js)

npm test                   # jest, with coverage, over src/**/*.{js,ts}
npm run test:watch         # jest --watch
npx jest path/to/File.test.ts               # run a single test file
npx jest -t "test name"                     # run tests matching a name

npm run lint               # eslint . "**/*.vue"
npm run lint:fix
npm run prettier           # check formatting
npm run prettier:fix
```

Frontend dev server runs at `http://localhost:8080` and proxies `/auth`, `/api`, `/json-api`, `/ping` and `/socket.io` to the backend on `http://localhost:4404`, so the browser stays same-origin (use :8080 in dev). Tests live under `tests/`, mirroring the `src/` structure, with fixture JSON under `tests/data/`.

Node version is pinned in `.node-version`. The backend uses `module-alias` at runtime (`_moduleAliases` in package.json maps `src` → `dist/src`), not TypeScript path aliases.

## Architecture

**Dual-protocol dispatch**: `src/routes/ApiRoute.ts` is the single entry point for both protocols. It reads `mode` (SABnzbd) or `t` (Newznab) from the query string and looks the value up in `EndpointDirectory` (`src/constants/EndpointDirectory.ts`) to find the handler — `SabNZBDEndpointDirectory` or `NewzNabEndpointDirectory`. Add a new protocol action by adding an endpoint under `src/endpoints/{sabnzbd,newznab,generic}/` and registering it in that directory, not by adding new routes.

**Facade layer**: `src/facade/*` (e.g. `searchFacade`, `downloadFacade`, `nzbFacade`, `arrFacade`, `scheduleFacade`) sits between endpoints and services, and is what most business logic and tests target. Endpoints stay thin; facades orchestrate services.

**Pluggable services via Abstract* base classes** — the config decides which concrete implementation is active at runtime:
- `src/service/search/`: `AbstractSearchService` → `GetIplayerSearchService` (shells out to `get_iplayer`) or `NativeSearchService`.
- `src/service/download/`: `AbstractDownloadService` → `GetIplayerDownloadService` or `YTDLPDownloadService`.
- `src/service/arr/`: `AbstractArrService` → `V1ArrService` / `V3ArrService` (Sonarr/Radarr API version differences).

When changing download or search behavior, check whether the change belongs in the abstract base or needs to be duplicated across both concrete implementations.

**Config**: runtime settings (API key, download/complete dirs, active download limit, refresh schedule, etc.) are defined in `src/types/IplayarrParameters.ts` and read via `src/service/configService`. They can come from environment variables or be set/persisted through the Settings UI — `configService` is the source of truth, not `process.env` directly.

**Database**: `src/service/db/prismaService` exposes a lazily-created Prisma client over SQLite (`better-sqlite3` adapter; file from `DATABASE_URL`, default `/config/iplayarr.db`). Schema in `prisma/schema.prisma` (`KeyValue`, `Cache`, `QueueItem`, `Session`); the tables are created idempotently at startup by `dbReady()`, so keep the DDL in `prismaService.ts` in step with the schema. `QueuedStorage` (key/value), `DbCacheService` (TTL caches), `DbFIFOQueue` (capped lists) and `PrismaSessionStore` (express-session) are the access layers. Tests use a real throwaway SQLite file per Jest worker (`tests/setup.ts`), cleared before each test. `redisImportService` does a one-time import from older Redis-based installs.

**Scheduling**: `src/service/taskService` (cron via `node-cron`) is initialized once at server startup (`src/server.ts`) for periodic jobs like schedule refresh.

**Realtime updates**: `src/service/socketService` wraps Socket.IO, registered on the same HTTP server as Express, for pushing queue/log updates to the frontend.

**Server bootstrap** (`src/server.ts`): auth middleware and `/auth` mounted first, then unauthenticated `/ping` healthcheck (queries the database), then static frontend (`frontend/dist`), then `/api` (the dual-protocol route above) and `/json-api` (the frontend's own REST API, under `src/routes/json-api/`), then a catch-all serving `frontend/dist/index.html` for client-side routing.

**Frontend**: Vue 3 + vue-router + Socket.IO client, under `frontend/src/`, built separately with Vite and served as static files by the Express backend in production.

## Docker image specifics

The Dockerfile builds Alpine + Node, downloads and bakes in a pinned `get_iplayer` version (`GET_IPLAYER_VERSION`) and latest `yt-dlp`, and keeps a Redis binary from the `redis:alpine` image solely so `docker_entry.sh` can read a legacy `/config/dump.rdb` once for the SQLite import. `docker_entry.sh` is the container entrypoint before `npm run start`. Source (`src/`, `frontend/src`) is stripped from the final image after build.
