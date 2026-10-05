# Settings reference

Every runtime setting in iPlayarr is an `IplayarrParameter` (`src/types/IplayarrParameters.ts`), read through `configService.getParameter`. Precedence is:

1. Value set via the Settings UI (persisted in Redis)
2. The matching environment variable
3. A built-in default, if one exists (`configService.ts`'s `defaultConfigMap`)

Not every parameter has a built-in default — some (`DOWNLOAD_DIR`, `COMPLETE_DIR`, `API_KEY`, `STREAM_KEY`, `STREAM_BASE_URL`, the `OIDC_*` fields) are either required or only meaningful once you've set them. `API_KEY` and `STREAM_KEY` are the two exceptions that auto-generate on first server start if unset (`src/server.ts`) rather than being left blank.

This is the master field reference. For step-by-step setup guides, see [STREAMING.md](STREAMING.md) and [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md); for a flat env-var lookup table, see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

Settings UI fields marked "Advanced" only appear after clicking the advanced-settings toggle in the Settings page toolbar.

## General (Settings → General)

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Api Key | `API_KEY` | _(auto-generated)_ | Secures the Newznab/SABnzbd API surface (`?apikey=`). Regenerate from the field's button; Settings will offer to push the new key out to configured Apps. |
| Native Search | `NATIVE_SEARCH` | `true` | Queries BBC's own search API + local Lunr re-ranking (`NativeSearchService`) instead of shelling out to `get_iplayer --search`. Toggling it clears the search cache. |
| Refresh Schedule _(advanced)_ | `REFRESH_SCHEDULE` | `0 * * * *` | Cron expression for the proactive BBC schedule refresh. Must be a valid cron string (validated server-side). |
| Hours in RSS Feed _(advanced)_ | `RSS_FEED_HOURS` | `48` | How far back the RSS feed endpoint looks. |
| Full Schedule Refresh _(advanced)_ | `SCHEDULE_FULL_REFRESH` | `false` | `false` reuses cached results for days in the schedule window that have already fully passed; `true` re-fetches every day on every refresh. |

Debug logging is controlled by the `DEBUG` env var (default `false`) — not exposed in the Settings UI, since it also flips permissive CORS for local frontend-dev-server use (`src/server.ts`). Set it in the container/process environment, not via Settings.

`PORT` (default `4404`) is also env-only, read directly from `process.env` at startup before configService/Redis are available.

## Authentication (Settings → Authentication)

See [AUTHENTICATION.md](AUTHENTICATION.md) for full behavior. Field summary:

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Authentication Enabled? (`AUTH_TYPE`) | `AUTH_TYPE` | `form` | `form` (username/password), `oidc` (OpenID Connect), or `none` (no login). |
| Username | `AUTH_USERNAME` | `admin` | Only shown/used when `AUTH_TYPE=form`. |
| Password | `AUTH_PASSWORD` | bcrypt hash of `password` | Stored as a bcrypt hash; legacy MD5 hashes are transparently upgraded to bcrypt on next successful login. |
| OIDC Configuration URL | `OIDC_CONFIG_URL` | _(unset)_ | OIDC discovery/config URL. Required when `AUTH_TYPE=oidc`. |
| OIDC Callback Host | `OIDC_CALLBACK_HOST` | _(unset)_ | Must match what you register as the callback URL with your OIDC provider (`<host>/auth/oidc/callback`). |
| OIDC Client ID | `OIDC_CLIENT_ID` | _(unset)_ | Required when `AUTH_TYPE=oidc`. |
| OIDC Client Secret | `OIDC_CLIENT_SECRET` | _(unset)_ | Required when `AUTH_TYPE=oidc`. |
| OIDC Allowed Emails | `OIDC_ALLOWED_EMAILS` | _(unset)_ | Comma-separated allow-list; a successful OIDC login is still rejected if the authenticated email isn't in this list. |

## Search

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Native Search | `NATIVE_SEARCH` | `true` | See General, above. |

## Download Client (Settings → Download Client)

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Download Limit | `ACTIVE_LIMIT` | `3` | Max simultaneous downloads. Must be a non-negative number. |
| Download Client? | `DOWNLOAD_CLIENT` | `GET_IPLAYER` | `GET_IPLAYER` or `YTDLP` (experimental) — which tool actually performs full downloads (`AbstractDownloadService` implementations). `YTDLP` in a non-root container needs `cap_add: [NET_BIND_SERVICE]` - see the note under [Stream Client](#streaming-settings--streaming) below. |
| Additional Download Parameters _(advanced)_ | `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` | _(unset)_ | Extra CLI parameters appended to the `get_iplayer` download invocation. |
| — | `GET_IPLAYER_EXEC` | `/iplayer/get_iplayer` (baked into the Docker image) | Path to the `get_iplayer` binary. Env-only; not in the Settings UI. |
| — | `YTDLP_EXEC` | `/ytdlp/yt-dlp` (baked into the Docker image) | Path to the `yt-dlp` binary. Env-only. |
| — | `SUB_DIR` | _(unset)_ | Optional subtitle download directory passed through to the downloader. Env-only. |
| — | `VIDEO_QUALITY` | `fhd` | Maximum quality requested from `get_iplayer`/`yt-dlp`/native streaming. Set via Settings → Media Management's "Video Quality" dropdown (populated from `json-api/config/qualityProfiles`), not a raw env var most users would hand-type. |
| — | `OUTPUT_FORMAT` | `mp4` | Output container (`mp4` or `mkv`) passed to `get_iplayer`. Settings → Media Management. |

## Media Management / Library (Settings → Media Management)

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Download Directory | `DOWNLOAD_DIR` | _(required, no default)_ | Where in-progress downloads land. |
| Complete Directory | `COMPLETE_DIR` | _(required, no default)_ | Where completed downloads are moved. |
| *arr Complete Directory | `ARR_COMPLETE_DIR` | _(unset)_ | Optional override of `COMPLETE_DIR` for TV downloads Sonarr/Radarr themselves queued only - manual UI downloads and subscriptions always use `COMPLETE_DIR`, even for TV. Leave blank to use `COMPLETE_DIR` for everything. |
| Video Quality | `VIDEO_QUALITY` | `fhd` | See above. |
| Output Format? | `OUTPUT_FORMAT` | `mp4` | `mp4` or `mkv`. |
| Archive Downloads? | `ARCHIVE_ENABLED` | `false` | Keep cancelled/removed queue and history items instead of discarding them. See `src/facade/downloadFacade.ts` and `historyService.addArchive`. |
| Organize into Folder Structure? | `LIBRARY_FOLDER_STRUCTURE` | `true` | Jellyfin-style `Show/Season NN/...` and `Movie/...` nesting under `COMPLETE_DIR`. See [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md). |
| Write .nfo Metadata Files? | `WRITE_NFO_STRM` | `manual` | `none` / `all` / `nzb` (Sonarr/Radarr-triggered only) / `manual` (UI-triggered only). See [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md). |
| Write .strmtool.json Files? | `WRITE_STRMTOOL_JSON` | `false` | Also writes a `.strmtool.json` sidecar next to each `.strm` file, for the StrmTool Jellyfin plugin's probe-skip cache. Only takes effect when `WRITE_NFO_STRM` is enabled and the completed item is a `.strm` (Media Mode = Streaming). See [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md). |
| TV Filename Template _(advanced)_ | `TV_FILENAME_TEMPLATE` | `{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.S{{season}}E{{episode}}{{#if episodeTitle}}.{{episodeTitle}}{{/if}}.WEBDL.{{quality}}-BBC` | Handlebars template; only affects the flat (non-folder-structure) filename. Must compile against `{title, season, episode, episodeTitle, synonym, quality}`. |
| Movie Filename Template _(advanced)_ | `MOVIE_FILENAME_TEMPLATE` | `{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.WEBDL.{{quality}}-BBC` | Same caveat as above. |
| — | `FALLBACK_FILENAME_SUFFIX` | `WEB.H264-BBC` | Env-only; suffix used when the structured metadata needed for the normal template isn't available. |

## Streaming (Settings → Streaming)

See [STREAMING.md](STREAMING.md) for the full setup walkthrough. Field summary:

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Media Mode | `MEDIA_MODE` | `strm` | `strm` (pointer file, resolved on playback) or `download` (full file). |
| Stream Base URL | `STREAM_BASE_URL` | _(required when `MEDIA_MODE=strm`)_ | Address your media server uses to reach iPlayarr; validated as a URL on save. |
| Stream Key | `STREAM_KEY` | _(auto-generated)_ | Secures `.strm` playback links, independent of `API_KEY`. |
| Stream Client | `STREAM_CLIENT` | `NATIVE` | `GET_IPLAYER`, `YTDLP`, or `NATIVE`. `YTDLP` (for this or `DOWNLOAD_CLIENT` above) needs `cap_add: [NET_BIND_SERVICE]` in a non-root container (i.e. one with `PUID`/`PGID` set) - without it, iPlayarr's DNS relay (a workaround for a musl-libc bug that otherwise breaks yt-dlp's DNS resolution) silently fails to bind port 53 and yt-dlp's resolution can fail. |
| Native Quality | `STREAM_NATIVE_ADAPTIVE` | `false` | Native client only. |
| Native Quality Probe | `STREAM_NATIVE_HQ_PROBE` | `false` | Native client only. |
| Native FHD Upgrade | `STREAM_NATIVE_EXPERIMENTAL_FHD` | `true` | Native client only. |
| Stream Mode | `STREAM_MODE` | `direct` | `direct` or `progressive-mkv` (needs `ffmpeg`). |
| Stream Cache Directory _(advanced)_ | `STREAM_CACHE_DIR` | temp folder | Scratch space for in-flight streams. |
| — | `THUMBNAIL_CACHE_DIR` | temp folder | Where cached BBC episode thumbnails are stored. Env-only. |

## Archive & Retention (Settings → Maintenance / Media Management)

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Archive Downloads? | `ARCHIVE_ENABLED` | `false` | See Media Management, above. |
| Thumbnail Cache Retention (Days) | `THUMBNAIL_RETENTION_DAYS` | `30` | Nightly cleanup (3:35am) deletes cached thumbnails unused past this many days. "Run Thumbnail Cleanup Now" button triggers it on demand. |
| Stream History Retention (Days) | `STREAM_HISTORY_RETENTION_DAYS` | `30` | Nightly cleanup (3:40am) deletes native streaming session history past this many days. Also has a manual "Run Now" button. |

## Redis (env-only — not in the Settings UI)

See [REDIS.md](REDIS.md) for full detail. These are read directly from `process.env` in `src/service/redis/redisService.ts`, not through `configService` — Redis has to be reachable before `configService` can read anything out of it, so these can't themselves live in Redis-backed config.

| Env var | Default | Notes |
| --- | --- | --- |
| `REDIS_HOST` | `127.0.0.1` | Hostname of an external Redis instance. |
| `REDIS_PORT` | `6379` | — |
| `REDIS_PASSWORD` | _(unset)_ | Optional. |
| `REDIS_SSL` | _(unset)_ | Set to `true` to connect over TLS. |

If none of these are set, the container starts its own bundled `redis-server` instead (`docker_entry.sh`).
