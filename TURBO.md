# iPlayarr Turbo

iPlayarr Turbo is a fork of [Nikorag/iplayarr](https://github.com/Nikorag/iplayarr) — the BBC iPlayer indexer/download-client for Sonarr and Radarr — built on top of upstream around **v0.11.6**. Everything upstream does, it still does (see the main [README.md](README.md) for the base feature set, install instructions, and Docker deployment). This document covers only what Turbo changes on top of that baseline.

This started as a ground-up modernization of the build/deploy tooling and dependency stack with no new end-user features. That's no longer true — real features have landed on top of upstream since: native (get_iplayer-free) streaming and search, `.strm`/Jellyfin-style library organization, a download archive, and a run of UI/usability work on the Apps, Queue, and NZB pages. Both kinds of change are documented below.

## Changes (at a glance)

**Features**

- **Native streaming** — `STREAM_CLIENT=NATIVE` (default) talks to BBC's streaming APIs directly instead of shelling out to `get_iplayer`/`yt-dlp`, with an adaptive bitrate ladder, an opt-in quality probe (`STREAM_NATIVE_HQ_PROBE`), and a 1080p upgrade trick (`STREAM_NATIVE_EXPERIMENTAL_FHD`). See [docs/STREAMING.md](docs/STREAMING.md).
- **`.strm` streaming mode** — `MEDIA_MODE=strm` writes a small pointer file instead of downloading the full media, so Sonarr/Radarr/Jellyfin see a "complete" item instantly and the file streams on demand through iPlayarr. See [docs/STREAMING.md](docs/STREAMING.md).
- **Jellyfin-style library organization + NFO metadata** — `LIBRARY_FOLDER_STRUCTURE` nests completed downloads into `Show/Season NN/...` (or a movie folder); `WRITE_NFO_STRM` writes matching `.nfo` metadata alongside. See [docs/LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md).
- **Browse UI** — Discover, Channels (with Now / Next and a multi-channel Schedule/TV-guide page), Categories (artwork tiles plus iPlayer's curated rails), A to Z and a Programme page, built on the BBC's iPlayer API with Redis caching. Play uses the in-app player and Download uses the normal queue. The search box suggests titles as you type, and the Search page gains a Posters view and a channel filter. Channel tiles and pills throughout the UI use each channel's real coloured BBC logo (with a hover popup and an off-toggle). See [docs/BROWSE.md](docs/BROWSE.md) and [docs/GETTING_STARTED_BBC.md](docs/GETTING_STARTED_BBC.md).
- **Subscriptions** — Subscribe to a show and new episodes are queued automatically (hourly check, plus on-demand), de-duplicated against the queue and history. See [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).
- **Download archive** — `ARCHIVE_ENABLED` keeps a record of cancelled/removed queue and history items instead of discarding them outright.
- **Apps page improvements** — a User-Agent lookup table attributes unauthenticated/app-ID-less search requests to the right Sonarr/Radarr instance, and Download Client/Indexer entries can now be deleted directly from the Apps form. See [docs/SONARR_RADARR_INTEGRATION.md](docs/SONARR_RADARR_INTEGRATION.md).
- **Mobile-responsive UI** — data tables (Queue, NZB, Streaming, Video Events, Apps) collapse into card layouts below 768px; modals widened with a scrollbar gutter so content doesn't touch the edges.
- **Schedule refresh caching** — `SCHEDULE_FULL_REFRESH` (false by default) skips re-fetching/re-parsing days of the BBC schedule that have already fully passed, instead of re-walking the whole window on every refresh.
- **Thumbnails and stream history** — episode thumbnails are cached locally (`THUMBNAIL_CACHE_DIR`, pruned nightly per `THUMBNAIL_RETENTION_DAYS`), and native streaming sessions are recorded with their own nightly cleanup (`STREAM_HISTORY_RETENTION_DAYS`).
- **Play Video (in-app preview player)** — a Play icon on Search results and Queue/History rows, and a "Play Video" button in the video info modal, plays any pid through the configured `STREAM_CLIENT`/`STREAM_MODE` right in the browser (hls.js, with real Picture-in-Picture when the browser supports it), independent of `MEDIA_MODE` — a quick way to confirm streaming settings actually work without downloading anything.

**Build/tooling (original scope)**

- **Real multi-stage Docker build** — separate `deps`/`build`/`prod-deps` stages feeding two final images: a slim `runtime` (production-only `node_modules`, no compiler toolchain, no source) and a `dev` target that keeps the full toolchain for hot-reloading against a bind-mounted `src/`. Previously this was a single stage that only deleted source _after_ copying it in, which doesn't actually shrink the image — Docker layers are additive, so the discarded files stayed in the image's history regardless.
- **Pinned, current base images** — `node:24-alpine3.24` (current Node LTS) in place of a floating `node:current-alpine3.20` tag that had silently drifted to Node 24 anyway; `redis:8-alpine3.23`; `get_iplayer` bumped to 3.36.
- **Frontend build tooling migrated from Vue CLI to Vite** — Vue CLI is unmaintained upstream and was the source of every remaining npm audit finding in the frontend (they traced to `@vue/cli-plugin-*` themselves, not sub-dependencies, so no version bump could close them). Vite is a faster dev server and actively maintained.
- **All npm audit findings resolved** — 0 vulnerabilities across both the backend and frontend, up from 32 and 60 respectively, via non-breaking bumps plus one deliberate major-version bump (`node-cron` 3→4, api-compatible with this project's usage).
- **CI consistency** — all three GitHub Actions workflows now run the same Node version as the Dockerfile (previously hardcoded to an EOL Node 23), and the Docker-publish workflow was fixed to actually publish this fork's own image, `ghcr.io/planet22/iplayarr-turbo`, instead of upstream's Docker Hub image.
- **Consolidated linting** — the frontend's own duplicate/conflicting ESLint 7 setup was removed in favor of the root's ESLint 9 flat config, which now genuinely lints every `.vue` file (a `--ext .ts` flag had silently limited the lint script to `.ts` files only, so the frontend was never actually being linted before).

---

## Feature additions

### Native streaming and `.strm` mode

`MEDIA_MODE=strm` (default) makes completed items a tiny `.strm` pointer file instead of the full media — Sonarr/Radarr see it as complete right away, and it plays on demand when opened; set `download` to fetch the full file instead. `STREAM_CLIENT` picks what actually serves the stream when that `.strm` file is opened: `NATIVE` (default, `src/service/stream/NativeStreamService.ts`), `GET_IPLAYER` (`GetIplayerStreamService.ts`, uses `get_iplayer --streaminfo`), or `YTDLP` (`YTDLPStreamService.ts`) — selected via `AbstractStreamService`, same pluggable-base pattern as search/download.

`NativeStreamService` resolves a playable URL by talking to BBC's `programmes/<pid>/playlist.json`, `mediaselector`, and HLS master playlist endpoints directly, bypassing `get_iplayer`/`yt-dlp` entirely for a large speed win (`get_iplayer --streaminfo` walks every programme version, each a ~13-15s CDN negotiation; native resolution is one targeted path). Three related flags, all under `STREAM_CLIENT=NATIVE`:

- `STREAM_NATIVE_ADAPTIVE` (default `false`) — hand the player the full HLS bitrate ladder for standard ABR, versus pinning one fixed quality from `VIDEO_QUALITY` (the default).
- `STREAM_NATIVE_HQ_PROBE` (default `false`) — fetch and compare every candidate HLS connection's real encoded height instead of trusting BBC's advertised connection metadata (which can under-report), at the cost of extra requests before playback starts.
- `STREAM_NATIVE_EXPERIMENTAL_FHD` (default `true`) — an isolated trick (`src/service/stream/experimental/bbcFhdUpgrade.ts`) that attempts to unlock genuine 1080p above BBC's usual 720p cap on native streams that have it; falls back cleanly if it doesn't apply.

`STREAM_MODE` controls how the resolved stream is served: `direct` (default, passthrough, supports seeking) or `progressive-mkv` (remuxed to MKV on the fly via ffmpeg, no seeking). `STREAM_BASE_URL` is the address your media server uses to reach iPlayarr for stream playback; `STREAM_KEY` is a separate secret (regenerable independently of `API_KEY`) that secures the links written into `.strm` files; `STREAM_CACHE_DIR` is where temporary files for in-flight streams live.

See [docs/STREAMING.md](docs/STREAMING.md) for setup steps.

### Browse UI

`/json-api/browse/*` (`src/routes/json-api/BrowseRoute.ts`, `src/service/browseService.ts`) is a read-only discovery API over the BBC's iPlayer API (`ibl.api.bbc.co.uk`), normalised to a `BrowseItem` that is shape-compatible with `IPlayerSearchResult`, so the existing `playInPip` player and `DownloadConfirmModal` accept it unchanged. Responses are cached in Redis (`browse_short`, 15 minutes; `browse_long`, 24 hours). Endpoints were verified against the live API: there is no site-wide highlights endpoint (Featured uses BBC One's channel highlights), channel ids differ from iPlayer's page ids (`src/constants/BrowseChannels.ts`), and the BBC `0-9` A-Z bucket is literally `0-9`.

Two pieces have no API and are scraped from iPlayer's own pages, best-effort: category rails (the `bundles` in the page's embedded state, each loaded through the regular groups endpoint) and channel logos (the nav's `-active` SVG variant per channel - a brand-coloured background rect plus a contrasting letter mark, same as iPlayer's own selected-channel state - served from `/channel-logo/:masterBrand.svg` and cached, never committed). `channelColors()` reads the first two fill colours back off that same cached SVG and exposes them via `/channel-colors`, keyed by display name with spaces stripped, so the frontend's `ChannelPill` component (`frontend/src/components/common/ChannelPill.vue`) can colour every channel pill in the app and show the logo in a hover/focus popup, without a second BBC fetch. Everything here degrades to the plain grid, plain-coloured pills, and text names if the BBC changes the page.

`browseService.schedule()` reuses the same per-channel/per-date IBL schedule call `nowNext()` makes, but keeps every broadcast instead of collapsing to just the current/next one - `GET /schedule?date=` returns the whole day across all 11 channels for the Schedule page's grid (`frontend/src/views/SchedulePage.vue`): channels as rows, programmes positioned on a shared timeline by actual start/end time, a live "now" line, zoom, and day navigation.

The frontend lives in `frontend/src/views/` (`DiscoverPage`, `TilesPage`, `GridPage`, `ChannelPage`, `SchedulePage`, `ProgrammePage`) and `frontend/src/components/browse/`. See [docs/BROWSE.md](docs/BROWSE.md).

### Subscriptions

`src/service/subscriptionService.ts` stores subscriptions in Redis (`QueuedStorage`, key `subscriptions`). Subscribing climbs to the show's brand pid and records every available episode as seen (refusing an empty list, which would otherwise make the first check download the whole back catalogue). A cron job (`17 * * * *`, in `taskService`) lists each show's episodes (paged), and queues unseen ones through `queueService.addToQueue` with `QueueEntrySource.MANUAL`, naming them with `createNZBName` and the matching synonym exactly as search results are named. Episodes already queued or in history are skipped; an episode that fails to queue stays unseen and is retried. "Download all" simply starts a subscription with an empty seen list and runs its first check in the background (guarded by a per-subscription in-flight set so no second check overlaps it), queuing oldest first. See [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).

### Jellyfin-style library organization

`LIBRARY_FOLDER_STRUCTURE` (default `false`) changes completed-download layout under `COMPLETE_DIR` from one flat folder to `Show Title/Season 01/Show Title - S01E02 - Episode Title.ext` for TV and `Movie Title/Movie Title.ext` for movies — see `src/utils/libraryPathBuilder.ts`. Sonarr/Radarr are told the correct nested relative path either way. `WRITE_NFO_STRM` (default `false`) additionally writes Jellyfin/Kodi/Emby-compatible `.nfo` metadata (`src/utils/nfoBuilder.ts`) alongside each completed item — episode/movie/show NFO, populated from the structured show/season/episode metadata now threaded through every download path (`QueueEntry.library`). Despite the name, `.nfo` writing isn't limited to `.strm` items; it fires for any completed download when enabled.

See [docs/LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md) for setup steps.

### Download archive

`ARCHIVE_ENABLED` (default `false`) preserves a record of queue/history items that would otherwise just be discarded: cancelling a queued item (`DELETE` on the SABnzbd queue endpoint) or removing a completed item from history both check this flag and, when set, call `historyService.addArchive` to keep an entry (status `CANCELLED`/`REMOVED`) rather than dropping it entirely. It's record-keeping, not a separate UI — archived entries surface through the same history/queue socket events as everything else.

### Apps page: User-Agent lookup and delete

See [docs/SONARR_RADARR_INTEGRATION.md](docs/SONARR_RADARR_INTEGRATION.md) for the user-facing writeup.

Search requests that arrive without an app ID (e.g. a manually-configured indexer in Sonarr/Radarr, rather than one created through iPlayarr's own Apps flow) previously couldn't be attributed to a specific app. The Apps page (`frontend/src/views/AppsPage.vue`) now has a User-Agent Lookup table: unrecognised User-Agent headers are captured automatically with a blank app, and filling one in lets iPlayarr attribute future matching requests (partial/substring match) to that app for stats and logging. Download Client and Indexer entries can now also be deleted straight from the Apps form, rather than only from Sonarr/Radarr's own side.

### Play Video (in-app preview player)

A Play icon (Search results, Queue/History table rows) and a "Play Video" button (video info modal, reachable from Queue, History, Streaming, NZB, and Video Events) stream a given pid straight through the browser, independent of `MEDIA_MODE` — useful for confirming `STREAM_CLIENT`/`STREAM_MODE` settings actually work before relying on them for real playback.

A single shared player (`frontend/src/lib/pipPlayer.js`, rendered once by `frontend/src/components/common/PipPlayer.vue` mounted at the app root) hits the same mode-agnostic `/api?mode=stream&pid=...` endpoint the `.strm` files themselves use, via `hls.js` for HLS manifests, falling back to a plain `<video src>` for progressive modes (`STREAM_MODE=direct` with a non-HLS client). It attempts real browser Picture-in-Picture first and falls back to playing inline in a small floating panel if PiP is unavailable or refused. Being a single instance mounted above the router, it keeps playing across page navigation the same way a real PiP window would.

### Mobile-responsive tables and modal fixes

Data tables on Queue, NZB, Streaming, Video Events, and Apps collapse into stacked card layouts below 768px instead of overflowing horizontally. Modals were widened and given a scrollbar gutter so their content doesn't visually collide with input boxes.

Search's download confirmation (rename the file before downloading) is now a modal (`frontend/src/components/modals/DownloadConfirmModal.vue`) opened in place, rather than navigating to a separate `/download` page (removed).

### Schedule refresh caching

`SCHEDULE_FULL_REFRESH` (default `false`) changes the hourly (by default, per `REFRESH_SCHEDULE`) BBC schedule refresh to only re-fetch/re-parse _today's_ page per channel, reusing a cached result for any day in the window that's already fully elapsed (it can't change once the day is over). Set to `true` to restore the old behavior of re-fetching every day in the window on every run, if the caching is ever suspected of causing stale/missing results.

### Thumbnail and stream history retention

Episode thumbnails fetched from the BBC are cached locally at `THUMBNAIL_CACHE_DIR` and pruned nightly (3:35am, fixed schedule) for anything unused past `THUMBNAIL_RETENTION_DAYS` (default `30`). Native streaming sessions are likewise recorded and pruned nightly (3:40am) past `STREAM_HISTORY_RETENTION_DAYS` (default `30`) — both surface on the Streaming page while within their retention window.

## Docker build

The Dockerfile is a genuine multi-stage build now, not a single stage that happened to delete some files partway through:

```
base ──▸ deps ──▸ build ─────────────┐
  └───▸ prod-deps ────────────────┐  │
redis (source image) ─────────────┤  │
                                   ▼  ▼
                          runtime-base
                            ├──▸ dev      (full node_modules, hot-reload)
                            └──▸ runtime  (prod-only node_modules — default target)
```

- `deps` installs everything (including devDependencies) once and is reused by both `build` (compiles backend + frontend) and, indirectly, the `dev` target.
- `prod-deps` runs a separate `npm ci --omit=dev` so the shipped image never contains `nodemon`, `ts-node`, `typescript`, or any other build-only tooling.
- `runtime-base` holds everything both final images need to actually run — `ffmpeg`, `get_iplayer`, `yt-dlp`, the bundled `redis-server` binary, and the compiled `dist/`/`frontend/dist` output — but no `node_modules` yet.
- `dev` layers the full `deps` node_modules on top of `runtime-base`; it's only ever produced by explicitly passing `target: dev` (as the personal dev compose file does), never the default.
- `runtime` layers the production-only node_modules on top and is the **last** stage in the file, so it's what gets built whenever nothing specifies a target — the published image and any production compose file included.

`atomicparsley` (still only packaged in Alpine's `edge/testing`, not any stable release) gets its own isolated `apk add --allow-untrusted`, so that flag doesn't weaken signature verification for every other package installed in the same image.

## Frontend: Vite instead of Vue CLI

- `vue.config.mjs` → `vite.config.mjs`: `@vitejs/plugin-vue` for single-file components, `vite-plugin-pwa` replacing `@vue/cli-plugin-pwa` (same generated `service-worker.js` filename, so existing browser registrations update in place instead of ending up with two).
- `process.env.NODE_ENV`/`BASE_URL` → `import.meta.env.PROD`/`DEV`/`BASE_URL` (Vite's convention; only three call sites in the whole app).
- `public/index.html` → `index.html` at the project root — Vite only treats `public/` as static passthrough assets, unlike Vue CLI/webpack's `htmlWebpackPlugin` templating.
- Net result: 423 packages instead of ~1,100+, and the frontend's `npm audit` findings went from 21 (all rooted in `@vue/cli-plugin-*`) to 0.

## Dependency/security posture

Both `package.json`s now carry an explicit `engines.node` (`24.x`), matching the Dockerfile and `.node-version`. `npm audit` is clean (0 vulnerabilities) on both the backend and frontend as of this fork's current `dev` branch — re-run `npm audit` before assuming that still holds after any future dependency bump.
