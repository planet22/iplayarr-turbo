# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

iPlayarr is a companion tool for Sonarr/Radarr that makes BBC iPlayer content searchable and downloadable through them. It presents itself over HTTP as two protocols simultaneously:

- A **Newznab-compatible indexer** (`?t=...` query param) — Sonarr/Radarr search it like a Usenet indexer.
- A **SABnzbd-compatible download client** (`?mode=...` query param) — Sonarr/Radarr queue/monitor "downloads" through it.

Underneath, it drives `get_iplayer` (Perl, bundled in the Docker image) and `yt-dlp` as the actual fetchers, and uses Redis for storage/queue state (bundled by default, or point at an external instance).

## Commands

Backend and frontend are separate npm projects (`/` and `/frontend`).

```bash
npm run install:both      # install deps for backend + frontend
npm run serve:redis       # start local Redis via docker compose (needed for local dev)
npm run dev                # run backend (nodemon) + frontend (vue-cli-service serve) concurrently, with DEBUG=true
npm run build:both         # build backend (tsc) + frontend (vue-cli-service build) for production
npm start                  # run the built backend (dist/src/server.js)

npm test                   # jest, with coverage, over src/**/*.{js,ts}
npm run test:watch         # jest --watch
npx jest path/to/File.test.ts               # run a single test file
npx jest -t "test name"                     # run tests matching a name

npm run lint               # eslint . --ext .ts
npm run lint:fix
npm run prettier           # check formatting
npm run prettier:fix
```

Frontend-only dev server runs at `http://localhost:8080`; backend API at `http://localhost:4404`. Tests live under `tests/`, mirroring the `src/` structure, with fixture JSON under `tests/data/`.

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

**Redis**: `src/service/redis/redisService` wraps `ioredis`; used for queue/download state and session storage (`connect-redis`). Tests mock it with `ioredis-mock`.

**Scheduling**: `src/service/taskService` (cron via `node-cron`) is initialized once at server startup (`src/server.ts`) for periodic jobs like schedule refresh.

**Realtime updates**: `src/service/socketService` wraps Socket.IO, registered on the same HTTP server as Express, for pushing queue/log updates to the frontend.

**Server bootstrap** (`src/server.ts`): auth middleware and `/auth` mounted first, then unauthenticated `/ping` healthcheck (checks Redis), then static frontend (`frontend/dist`), then `/api` (the dual-protocol route above) and `/json-api` (the frontend's own REST API, under `src/routes/json-api/`), then a catch-all serving `frontend/dist/index.html` for client-side routing.

**Frontend**: Vue 3 + vue-router + Socket.IO client, under `frontend/src/`, built separately with `vue-cli-service` and served as static files by the Express backend in production.

## Docker image specifics

The Dockerfile builds Alpine + Node, downloads and bakes in a pinned `get_iplayer` version (`GET_IPLAYER_VERSION`) and latest `yt-dlp`, and vendors a Redis binary from the `redis:alpine` image for the bundled-Redis mode. `docker_entry.sh` is the container entrypoint before `npm run start`. Source (`src/`, `frontend/src`) is stripped from the final image after build.
