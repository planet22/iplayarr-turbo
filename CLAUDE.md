# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code modification or creation instructions

Before changing anything, list every file you'll need and read them in one pass. Then make all edits, then run the tests once.

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
npm run test:frontend      # vitest (happy-dom) over frontend/tests: lib, components, pages (backend Jest ignores it)
npm run test:watch         # jest --watch
npx jest path/to/File.test.ts               # run a single test file
npx jest -t "test name"                     # run tests matching a name

npm run lint               # eslint . "**/*.vue"
npm run lint:fix
npm run prettier           # check formatting
npm run prettier:fix
```

Frontend dev server runs at `http://localhost:8080` and proxies `/auth`, `/api`, `/json-api`, `/ping` and `/socket.io` to the backend on `http://localhost:4404`, so the browser stays same-origin (use :8080 in dev). Tests live under `tests/`, mirroring the `src/` structure, with fixture JSON under `tests/data/`.

**Running jest/lint when the repo is on a Windows network share (e.g. `Y:\`)**: `npm install`/`npm ci` fails there (`EUNKNOWN ... symlink`) because npm workspaces symlink `frontend` into `node_modules`, so there is no `node_modules` to run jest from. Run tests from a local copy instead:

1. Copy the repo to a local drive (robocopy `/E`), leaving out `node_modules`, `.git`, `dist`, `coverage`, `cache`, `logs` and the _top-level_ `config/`. Keep `src/config/` (it holds `version.json`; suites fail to compile without it). Delete the copied `.env` and any personal `docker-compose*.yaml`.
2. In the copy: `npm ci`, then `npx prisma generate` (install does not generate the Prisma client; without it suites fail with "no exported member PrismaClient"), then `npm test` / `npx jest <file>` / `npm run lint`.
3. After editing the share, resync (`robocopy <share>\src <copy>\src /MIR`, same for `tests` and `frontend\src`, plus changed root files) before re-running.

Known baseline noise: `tests/service/versionService.test.ts` hard-codes `/tmp` and fails 5 tests on Windows; `npm run prettier` already flags many files. Lint requires single quotes (escape apostrophes) and sorted imports. On Linux/macOS/WSL or in a container, none of this is needed: `npm ci && npx prisma generate && npm test`.

Node version is pinned in `.node-version`. The backend uses `module-alias` at runtime (`_moduleAliases` in package.json maps `src` → `dist/src`), not TypeScript path aliases.

## Architecture

**Dual-protocol dispatch**: `src/routes/ApiRoute.ts` is the single entry point for both protocols. It reads `mode` (SABnzbd) or `t` (Newznab) from the query string and looks the value up in `EndpointDirectory` (`src/constants/EndpointDirectory.ts`) to find the handler — `SabNZBDEndpointDirectory` or `NewzNabEndpointDirectory`. Add a new protocol action by adding an endpoint under `src/endpoints/{sabnzbd,newznab,generic}/` and registering it in that directory, not by adding new routes.

**Facade layer**: `src/facade/*` (e.g. `searchFacade`, `downloadFacade`, `nzbFacade`, `arrFacade`, `scheduleFacade`) sits between endpoints and services, and is what most business logic and tests target. Endpoints stay thin; facades orchestrate services.

**Release resolver** (`src/service/releaseService.ts`): the one place that works out what a programme is called and where it goes. `resolveRelease(pid, {version, quality, nameOverride})` derives the release name, film/TV type and library metadata (series, episode, pubDate, runtime...) from the BBC details (`iplayerDetailsService`, where airdate/TVDB numbering lives) and never trusts numbering sent by the browser; `enqueueRelease` resolves and calls `queueService.addToQueue`. The Download route, collection downloads, the generic `DownloadEndpoint`, subscriptions and the debug page's File naming (`namingPreview`) all use it, so they can't disagree; a new way to start a download calls it too. Options keep each caller's old behaviour: `typeFrom: 'category'` (film by the BBC format category rather than missing numbering), `nameStyle: 'plain'` (title.subtitle name), `numberingFromName`, and, on `enqueueRelease`, `fallback` (the caller's own name/type/library, queued if the BBC cannot answer). The Download dialog gets its suggested name from `GET /json-api/release-preview`, and the browser sends a filename only when the user typed one (`nameEdited=1`). Sonarr/Radarr NZB grabs (`AddFileEndpoint`) keep the name and numbering in the NZB.

**Pluggable services via Abstract\* base classes** — the config decides which concrete implementation is active at runtime:

- `src/service/search/`: `AbstractSearchService` → `GetIplayerSearchService` (shells out to `get_iplayer`) or `NativeSearchService`.
- `src/service/download/`: `AbstractDownloadService` → `GetIplayerDownloadService`, `YTDLPDownloadService` or `NativeDownloadService` (reuses `NativeStreamService.resolveDownloadUrl`, ffmpeg copies the HLS stream).
- `src/service/arr/`: `AbstractArrService` → `V1ArrService` / `V3ArrService` (Sonarr/Radarr API version differences).

When changing download or search behavior, check whether the change belongs in the abstract base or needs to be duplicated across both concrete implementations.

**Arr API versions**: each arr service declares its `apiVersion`/`getApiUrl`, and `ArrLibraryService` resolves URLs through `ArrServiceDirectory`, so a new Sonarr/Radarr API version is a subclass plus one directory entry.

**Subscription detection**: `subscriptionDetectService` scans Sonarr/Radarr for shows pointing at iPlayarr (`.strm` links, files with the `BBCiPlayarrTurbo` release group from `utils/releaseGroup.ts`, optionally grab history). Finds are kept under the `subscription_detected` key; a daily task refreshes counts for apps with `detectSubscriptions` on. Routes are under `/json-api/subscriptions/arr/detected`. See [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).

**Debug hub**: `/debug` (`frontend/src/views/Debug*Page.vue`) is opened by a navbar bug icon, gated by `UI_EXTENDED_DEBUG` through `useDebugLink`. Backend: `routes/json-api/DebugRoute.ts` (`/json-api/debug/health` from `service/debugHealthService.ts`, whose folder check writes and removes a test file; `/subscription-trace` from `subscriptionDetectService.trace()`). Both are read-only. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#debug-hub).

**Stream trace** (`STREAM_TRACE`, default off): a per-stream request log for the stutter/repeat page `/streaming/session/:id`, opened from a timeline icon on each Streaming row. `service/stream/streamRequestLog.ts` records, per session, each request the player made (order, timings, player headers, what BBC returned, first MPEG-TS timestamps from `tsTimestamps.ts`) and each playlist as BBC sent it and as passed on (query strings removed); `streamProxyUtils.ts` feeds it. It is passive and fail-safe, and with the setting off `begin`/`setPlaylist`/`setSegmentInfo` return at once and the proxy skips its trace work (`configService` keeps the in-memory switch in step, like `LIVE_RADIO`). Logs are stored under `streamLog:<id>` / `streamPlaylists:<id>` (gzip) beside the history row and pruned with it. Route: `GET /json-api/streams/trace/:id` (+ `/playlist/:key`). `tsTimestamps.videoSize()` reads the H.264 SPS picture size, and `NativeStreamService` captures the master read during resolve when the player gets a single pinned variant; both feed `DeliveredQuality`. Charts keep a labelled scale, gridlines that follow height, no value labels when small, and one icon per meaning. Frontend: `StreamSessionDebugPage.vue`, `DeliveredQuality`, `RequestTimeline`, `StreamHealthCharts`, `SegmentGridPanel`, `PlaylistPanel`, parsers in `lib/requestTimeline.js` and `lib/hlsPlaylist.js`. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#stream-trace-stutter-or-repeats).

**Server stats** (Statistics page, Server section): `GET /json-api/stats/server` (quick: memory, CPU, `statfs` of the download and complete folders, database size, library count, queue/streams/sockets, cache hit rate, scheduler, network bytes from `/proc/net/dev`: container-wide, cumulative since start, rate between calls, null off Linux) and `/server/checks` (BBC probe cached 60 s, Sonarr/Radarr `testConnection`), both from `service/stats/serverStatsService.ts`, read-only, each group `null` on failure. The page turns them into six untitled cards in `frontend/src/lib/serverStats.js` (`buildServerGroups`) drawn by `ServerStatCard.vue`.

**Async routes and validation**: json-api routers and `ApiRoute` go through `utils/asyncRouter.ts` so a rejected handler reaches the error handler instead of hanging the request. Settings are validated on save in `validators/ConfigFormValidator.ts`; a new setting needs a rule there and an entry in `smoke/settings.cjs`.

**Native subtitles** (`STREAM_SUBTITLES`, default on): `src/service/stream/subtitles/` converts the BBC's TTML captions to WebVTT and `proxyUrl` (`streamProxyUtils.ts`) adds them to the HLS master as a subtitle rendition when `NativeStreamService`/`LiveStreamService` pass it a subtitle playlist URI (served by `StreamEndpoint`'s `subs=` branch). With the setting off the proxy is called exactly as before. Cue times are deliberately written on the video's own timeline with an identity `X-TIMESTAMP-MAP` - ffmpeg (so Jellyfin) ignores the map. See [docs/STREAMING.md](docs/STREAMING.md#subtitles).

**Config**: runtime settings (API key, download/complete dirs, active download limit, refresh schedule, etc.) are defined in `src/types/IplayarrParameters.ts` and read via `src/service/configService`. They can come from environment variables or be set/persisted through the Settings UI — `configService` is the source of truth, not `process.env` directly.

**Database**: `src/service/db/prismaService` exposes a lazily-created Prisma client over SQLite (`better-sqlite3` adapter; file from `DATABASE_URL`, default `/config/iplayarr.db`). Schema in `prisma/schema.prisma` (`KeyValue`, `Cache`, `QueueItem`, `Session`); the tables are created idempotently at startup by `dbReady()`, so keep the DDL in `prismaService.ts` in step with the schema. `QueuedStorage` (key/value), `DbCacheService` (TTL caches), `DbFIFOQueue` (capped lists) and `PrismaSessionStore` (express-session) are the access layers. Tests use a real throwaway SQLite file per Jest worker (`tests/setup.ts`), cleared before each test. `redisImportService` does a one-time import from older Redis-based installs.

**Scheduling**: `src/service/taskService` (cron via `node-cron`) is initialized once at server startup (`src/server.ts`) for periodic jobs like schedule refresh.

**Realtime updates**: `src/service/socketService` wraps Socket.IO, registered on the same HTTP server as Express, for pushing queue/log updates to the frontend.

**Server bootstrap** (`src/server.ts`): auth middleware and `/auth` mounted first, then unauthenticated `/ping` healthcheck (queries the database), then static frontend (`frontend/dist`), then `/api` (the dual-protocol route above) and `/json-api` (the frontend's own REST API, under `src/routes/json-api/`), then a catch-all serving `frontend/dist/index.html` for client-side routing.

**Frontend**: Vue 3 + vue-router + Socket.IO client, under `frontend/src/`, built separately with Vite and served as static files by the Express backend in production.

**Theming**: colour schemes and light/dark mode are per-browser (`frontend/src/lib/theme.js`, `themes.js`). The Less colour variables in `variables.less` are `var(--...)` references, so style with the variables (or the role tokens) and never a raw colour unless it must stay fixed (text over posters). Settings-page edits, including the Appearance prefs, only apply on Save. See [docs/THEMING.md](docs/THEMING.md).

## Docker image specifics

The Dockerfile builds Alpine + Node, downloads and bakes in a pinned `get_iplayer` version (`GET_IPLAYER_VERSION`) and latest `yt-dlp`, and keeps a Redis binary from the `redis:alpine` image solely so `docker_entry.sh` can read a legacy `/config/dump.rdb` once for the SQLite import. `docker_entry.sh` is the container entrypoint before `npm run start`. Source (`src/`, `frontend/src`) is stripped from the final image after build.
