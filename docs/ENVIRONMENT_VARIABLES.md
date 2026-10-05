# Environment variables

Quick-lookup reference. Every one of these (except the Redis connection and process-level ones noted below) can also be set or changed later via the Settings UI — `configService` reads a UI-set value first, then the environment variable, then falls back to a built-in default if neither is set (`src/service/configService.ts`'s `getParameter`). See [CONFIG.md](CONFIG.md) for what each one does and which Settings tab it lives under.

| Variable | Default | Required? | Description |
| --- | --- | --- | --- |
| `API_KEY` | _(auto-generated)_ | No (generated on first start) | Secures the Newznab/SABnzbd API. |
| `DOWNLOAD_DIR` | _(none)_ | **Yes** | In-progress download directory. |
| `COMPLETE_DIR` | _(none)_ | **Yes** | Completed download directory. |
| `ARR_COMPLETE_DIR` | _(unset)_ | No | Override of `COMPLETE_DIR` for TV (*arr) downloads only. |
| `ACTIVE_LIMIT` | `3` | No | Max simultaneous downloads. |
| `DOWNLOAD_CLIENT` | `GET_IPLAYER` | No | `GET_IPLAYER` or `YTDLP`. |
| `GET_IPLAYER_EXEC` | `/iplayer/get_iplayer` (Docker image) | No | Path to the `get_iplayer` binary. |
| `YTDLP_EXEC` | `/ytdlp/yt-dlp` (Docker image) | No | Path to the `yt-dlp` binary. |
| `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` | _(unset)_ | No | Extra CLI params passed to `get_iplayer` downloads. |
| `SUB_DIR` | _(unset)_ | No | Optional subtitle output directory. |
| `VIDEO_QUALITY` | `hd` | No | Max requested video quality. |
| `OUTPUT_FORMAT` | `mp4` | No | `mp4` or `mkv`. |
| `LIBRARY_FOLDER_STRUCTURE` | `false` | No | Jellyfin-style `Show/Season/...` folder nesting. |
| `WRITE_NFO_STRM` | `none` | No | `none` / `all` / `nzb` / `manual` — writes `.nfo` metadata. |
| `TV_FILENAME_TEMPLATE` | see [CONFIG.md](CONFIG.md) | No | Handlebars template for flat TV filenames. |
| `MOVIE_FILENAME_TEMPLATE` | see [CONFIG.md](CONFIG.md) | No | Handlebars template for flat movie filenames. |
| `FALLBACK_FILENAME_SUFFIX` | `WEB.H264-BBC` | No | Suffix used when template metadata is unavailable. |
| `REFRESH_SCHEDULE` | `0 * * * *` | No | Cron expression for schedule refresh. |
| `SCHEDULE_FULL_REFRESH` | `false` | No | Re-fetch every day in the window instead of caching passed days. |
| `RSS_FEED_HOURS` | `48` | No | Lookback window for the RSS feed endpoint. |
| `NATIVE_SEARCH` | `true` | No | Use BBC's native search API instead of `get_iplayer --search`. |
| `ARCHIVE_ENABLED` | `false` | No | Keep cancelled/removed queue+history items as archive records. |
| `AUTH_TYPE` | `form` | No | `form` / `oidc` / `none`. |
| `AUTH_USERNAME` | `admin` | No | Login username (`form` auth). |
| `AUTH_PASSWORD` | bcrypt hash of `password` | No | Login password, stored hashed. |
| `OIDC_CONFIG_URL` | _(unset)_ | Only if `AUTH_TYPE=oidc` | OIDC discovery URL. |
| `OIDC_CLIENT_ID` | _(unset)_ | Only if `AUTH_TYPE=oidc` | OIDC client ID. |
| `OIDC_CLIENT_SECRET` | _(unset)_ | Only if `AUTH_TYPE=oidc` | OIDC client secret. |
| `OIDC_CALLBACK_HOST` | _(unset)_ | Only if `AUTH_TYPE=oidc` | Must match the registered OIDC callback host. |
| `OIDC_ALLOWED_EMAILS` | _(unset)_ | Only if `AUTH_TYPE=oidc` | Comma-separated allow-list of emails. |
| `MEDIA_MODE` | `strm` | No | `strm` or `download`. |
| `STREAM_BASE_URL` | _(unset)_ | Only if `MEDIA_MODE=strm` | Address your media server uses to reach iPlayarr. |
| `STREAM_KEY` | _(auto-generated)_ | No | Secures `.strm` playback links. |
| `STREAM_CLIENT` | `NATIVE` | No | `GET_IPLAYER` / `YTDLP` / `NATIVE`. |
| `STREAM_MODE` | `direct` | No | `direct` or `progressive-mkv`. |
| `STREAM_CACHE_DIR` | temp folder | No | Scratch directory for in-flight streams. |
| `STREAM_NATIVE_ADAPTIVE` | `false` | No | Adaptive bitrate for native streaming. |
| `STREAM_NATIVE_HQ_PROBE` | `false` | No | Verify real connection quality before playing. |
| `STREAM_NATIVE_EXPERIMENTAL_FHD` | `true` | No | 1080p unlock trick for native streaming. |
| `THUMBNAIL_CACHE_DIR` | temp folder | No | Where cached BBC thumbnails are stored. |
| `THUMBNAIL_RETENTION_DAYS` | `30` | No | Thumbnail cache cleanup window. |
| `STREAM_HISTORY_RETENTION_DAYS` | `30` | No | Native stream history cleanup window. |
| `HIDE_DONATE` | _(unset)_ | No | Hides the Ko-fi donate links in the UI. |
| `PUID` | `1000` | No | Host user ID the container runs as (`docker_entry.sh`). |
| `PGID` | `1000` | No | Host group ID the container runs as. |

**Process-level, not read through `configService` (set only via environment, never the Settings UI):**

| Variable | Default | Required? | Description |
| --- | --- | --- | --- |
| `PORT` | `4404` | No | HTTP port, read directly from `process.env` before the config store is available. |
| `DEBUG` | `false` | No | Verbose request logging + permissive CORS for local frontend-dev-server use. |
| `SESSION_SECRET` | `default_secret_key` | No, but should be changed in production | Express session signing secret (`src/routes/AuthRoute.ts`). |
| `LOG_DIR` | `/logs` (Docker image) | No | Directory for rotated log files. |
| `NODE_ENV` | _(unset)_ | No | Set to `test` by the test runner to suppress file logging. |
| `REDIS_HOST` | `127.0.0.1` | No | External Redis hostname; if unset the bundled Redis starts instead. |
| `REDIS_PORT` | `6379` | No | — |
| `REDIS_PASSWORD` | _(unset)_ | No | — |
| `REDIS_SSL` | _(unset)_ | No | Set to `true` for TLS. |

See [REDIS.md](REDIS.md) for why the Redis connection variables can't themselves be stored in Redis-backed config.
