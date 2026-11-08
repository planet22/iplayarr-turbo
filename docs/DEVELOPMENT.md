# Development

Contributor-facing setup. See the main [README.md](../README.md#development-setup) for the condensed version; this expands on testing, linting, and where things live.

## Prerequisites

- Node.js — version pinned in `.node-version` (currently tracks Node 24, matching the Dockerfile's `node:24-alpine3.24`).
- Nothing else: the database is a SQLite file created automatically at `./config/iplayarr.db` (override with `DATABASE_URL`, see [DATABASE.md](DATABASE.md)). After changing `prisma/schema.prisma`, run `npm run prisma:generate` and update the matching statements in `src/service/db/prismaService.ts`.

## Setup

```bash
npm install   # one install at the root covers backend + the /frontend workspace
npm run dev            # runs backend (nodemon) + frontend (vite dev server) concurrently, DEBUG=true
```

npm workspaces link `frontend` into `node_modules` with a symlink, so run `npm install` on a local drive (or in WSL or a container). It fails with `EUNKNOWN ... symlink` on a mapped network share such as an SMB drive.

- Frontend dev server: `http://localhost:8080`
- Backend API: `http://localhost:4404`

`DEBUG=true` (set automatically by `npm run dev`) enables verbose request/response logging (`src/server.ts`). The Vite dev server proxies backend routes to :4404, so there is no CORS in dev.

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

Tests live under `tests/`, mirroring the `src/` directory structure (e.g. `src/facade/searchFacade.ts` → `tests/facade/searchFacade.test.ts`). Fixture JSON lives under `tests/data/`. Tests use a real throwaway SQLite file per Jest worker (`tests/setup.ts`), cleared before each test, so nothing external needs to run. Frontend helpers in `frontend/src/lib` (for example `downloadSummary`) have Jest tests too.

## Smoke tests

`smoke/` holds Playwright/HTTP scripts run against a live instance: `smoke.cjs` (read-only: API, Newznab/SABnzbd, browse, UI at desktop and phone widths), `smoke.cjs --write` (adds `reallife.cjs` and `uireal.cjs`: subscribes, queues, streams, changes and reverts settings), `settings.cjs` (every setting changed, read back and restored; fails if a setting has no entry) and `probes.cjs` (data quality, hostile input, SSRF guards, config races). `smoke/SMOKE_PROMPT.md` is a repeatable prompt for running the lot. `--write` already includes the read-only pass, so there is no need to run both. `--concurrency N` (or `SMOKE_CONCURRENCY`) runs the independent read-only checks (searches, junk-input probes, collection pictures, the page sweep, card grids) N at a time with results kept in order; the default `1` is the plain sequential run, and anything that changes data always runs one step at a time. `--write --only write` (just the write groups) finds the programme, channel and settings it needs with a short discovery instead of the full API pass. `--no-shots` skips the sweep screenshots, `--only`/`--filter` run part of the suite (`--list` shows the names), and `--list-checks` prints every check name. `jellyfin.cjs` is an optional extra for dev instances with a Jellyfin server: it downloads a film collection as `.strm` links into a scratch folder, checks Jellyfin gathers them into a BoxSet and can probe a film, then removes what it made. It reads its settings (instance and Jellyfin URLs, Jellyfin API key, scratch folder as the apps and as this machine see it) from the environment or a `.env`, or asks when run in a terminal, and skips with exit code 2 without them; the logic is unit tested against a fake server in `tests/smoke/`.

## Conventions worth knowing

- **Async routes:** Express 4 ignores the promise an async handler returns, so a throw would leave the request hanging. `src/utils/asyncRouter.ts` wraps every json-api router and `ApiRoute` so rejections reach the error handler. Use it for new routers.
- **Input validation:** `src/validators/ConfigFormValidator.ts` checks settings on save (allowed values, cron, URLs, ranges). When adding a setting, add its rule there and an entry in `smoke/settings.cjs`. Validators treat non-text input as missing (400).
- **Release group:** `src/utils/releaseGroup.ts` owns `BBCiPlayarrTurbo` (`applyGroupToTemplate`, `applyGroupToName`, `templateGroupProblem`).
- **Arr API versions:** each `AbstractArrService` subclass declares its `apiVersion` and `getApiUrl`; `ArrLibraryService` resolves URLs through `ArrServiceDirectory`. A new Sonarr/Radarr API version is a subclass plus one directory entry.
- **Subscription detection:** `src/service/subscriptionDetectService.ts` scans Sonarr/Radarr for shows pointing at iPlayarr; finds are stored under the `subscription_detected` key and the daily `subscriptions-detect` task refreshes them. `src/service/appSeen.ts` stamps an app's last-seen time.
- **Progress events:** subscription checks and image updates emit `subscriptionProgress` over Socket.IO.
- **Reverse proxy:** `TRUST_PROXY` (`src/utils/trustProxy.ts`) sets Express's proxy trust so rate limits see real client addresses.

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
- **Library index** (`src/service/libraryIndexService.ts`) — the one answer to "what is on disk". Per-source scans (`history`, `folders`, `app:<id>`) are kept in a persistent cache; consumers ask it (`onDisk`, `countsForShow`, `filesOfShow`, `episodes`, `counts`, `access`) and never walk folders or list an app themselves. Refresh with `refreshShow`, `refreshArr`, `scanFolders` or `scan`. Tests that mock `ArrLibraryService` need `getLibraryFiles` and `listLibrary`.
- **Frontend** (`frontend/src/`) — Vue 3 + vue-router + Socket.IO client, built with Vite, served as static files by the Express backend in production (`frontend/dist`).

Read [CLAUDE.md](../CLAUDE.md) in full before making a non-trivial change — it covers the dual-protocol dispatch (`ApiRoute.ts`), config precedence, and server bootstrap order in more detail than is repeated here.
