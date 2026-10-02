# Development

Contributor-facing setup. See the main [README.md](../README.md#development-setup) for the condensed version; this expands on testing, linting, and where things live.

## Prerequisites

- Node.js — version pinned in `.node-version` (currently tracks Node 24, matching the Dockerfile's `node:24-alpine3.24`).
- Docker — for a local Redis instance (`npm run serve:redis`). You can point at any other reachable Redis instead via `REDIS_HOST`/`REDIS_PORT` (see [REDIS.md](REDIS.md)).

## Setup

```bash
npm run install:both   # installs deps for both / (backend) and /frontend
npm run serve:redis    # starts Redis via docker-compose.redis.yml
npm run dev            # runs backend (nodemon) + frontend (vite dev server) concurrently, DEBUG=true
```

- Frontend dev server: `http://localhost:8080`
- Backend API: `http://localhost:4404`

`DEBUG=true` (set automatically by `npm run dev`) enables permissive CORS and verbose request/response logging (`src/server.ts`), so the two dev servers on different ports/origins can talk to each other.

## Module resolution: module-alias, not TS paths

The backend uses `module-alias` at runtime, not TypeScript path aliases. `_moduleAliases` in `package.json` maps the `src` import prefix to `dist/src` — so imports like `import x from 'src/...'` only resolve correctly against the **compiled** output, not raw `.ts` files. This matters if you add a new top-level import path convention: it needs a matching `_moduleAliases` entry, and you need to `npm run build:both` (or let nodemon's build-on-change do it) before it'll resolve, not just save the `.ts` file.

## Building

```bash
npm run build:both   # tsc for backend, vite build for frontend
npm start             # runs the built backend from dist/src/server.js
```

## Testing

```bash
npm test                                      # jest, with coverage, over src/**/*.{js,ts}
npm run test:watch                            # jest --watch
npx jest path/to/File.test.ts                 # run a single test file
npx jest -t "test name"                       # run tests matching a name
```

Tests live under `tests/`, mirroring the `src/` directory structure (e.g. `src/facade/searchFacade.ts` → `tests/facade/searchFacade.test.ts`). Fixture JSON lives under `tests/data/`. Redis is mocked with `ioredis-mock` in tests — you don't need a real Redis instance running to run the test suite.

## Linting and formatting

```bash
npm run lint         # eslint . "**/*.vue"
npm run lint:fix
npm run prettier     # check formatting
npm run prettier:fix
```

ESLint 9's flat config at the repo root covers both the backend and every `.vue` file in the frontend — there's no separate frontend lint config to keep in sync.

## Where to make changes

iPlayarr is layered: thin endpoints → facades (business logic, what tests target) → pluggable services. Full breakdown is in [CLAUDE.md](../CLAUDE.md) — the short version:

- **Endpoints** (`src/endpoints/{sabnzbd,newznab,generic}/`) — one per protocol action, registered in `src/constants/EndpointDirectory.ts`. Add a new SABnzbd/Newznab action here, not as a new Express route.
- **Facades** (`src/facade/*`) — orchestration layer between endpoints and services. Most business logic and unit tests live at this layer.
- **Services** (`src/service/**`) — the actual work. Several are pluggable via an `Abstract*` base class with multiple concrete implementations selected at runtime by config (search, download, streaming, Sonarr/Radarr API version). When changing behavior here, check whether the change belongs in the shared abstract base or needs to be duplicated across concrete implementations.
- **Frontend** (`frontend/src/`) — Vue 3 + vue-router + Socket.IO client, built with Vite, served as static files by the Express backend in production (`frontend/dist`).

Read [CLAUDE.md](../CLAUDE.md) in full before making a non-trivial change — it covers the dual-protocol dispatch (`ApiRoute.ts`), config precedence, and server bootstrap order in more detail than is repeated here.
