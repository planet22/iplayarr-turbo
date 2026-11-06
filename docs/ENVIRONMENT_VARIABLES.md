# Environment variables

Quick-lookup reference. Numeric settings are clamped into their allowed range when read (see [CONFIG.md](CONFIG.md#using-the-settings-page)). Every one of these (except the database location and process-level ones noted below) can also be set or changed later via the Settings UI — `configService` reads a UI-set value first, then the environment variable, then falls back to a built-in default if neither is set (`src/service/configService.ts`'s `getParameter`). See [CONFIG.md](CONFIG.md) for what each one does and which Settings tab it lives under.

| Variable | Default | Required? | Description |
| --- | --- | --- | --- |
| `API_KEY` | _(auto-generated)_ | No (generated on first start) | Secures the Newznab/SABnzbd API. |
| `DOWNLOAD_DIR` | _(none)_ | **Yes** | In-progress download directory. |
| `COMPLETE_DIR` | _(none)_ | **Yes** | Completed download directory. |
| `ARR_COMPLETE_DIR` | _(unset)_ | No | Override of `COMPLETE_DIR` for TV downloads Sonarr/Radarr themselves queued only - not manual UI downloads or subscriptions, even for TV. |
| `ACTIVE_LIMIT` | `4` | No | Max simultaneous downloads (1-10). |
| `DOWNLOAD_CLIENT` | `NATIVE` | No | `NATIVE`, `GET_IPLAYER` or `YTDLP`. |
| `GET_IPLAYER_EXEC` | `/iplayer/get_iplayer` (Docker image) | No | Path to the `get_iplayer` binary. |
| `YTDLP_EXEC` | `/ytdlp/yt-dlp` (Docker image) | No | Path to the `yt-dlp` binary. |
| `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` | _(unset)_ | No | Extra CLI params passed to `get_iplayer` downloads. |
| `VIDEO_QUALITY` | `fhd` | No | Max requested video quality. |
| `OUTPUT_FORMAT` | `mp4` | No | `mp4` or `mkv`. |
| `EXTRA_VIDEO_QUALITIES` | _(empty)_ | No | Comma-separated extra qualities offered as additional search results. |
| `EXTRA_VERSIONS` | _(empty)_ | No | Comma-separated programme versions (`audio-described`, `signed`) listed as separate tagged releases. See [CONFIG.md](CONFIG.md#versions-audio-described-and-signed). |
| `RELEASE_LANGUAGE` | `english` | No | Language tag added to release names (for Sonarr/Radarr's parser). |
| `AIRDATE_NUMBERING` | `false` | No | Number episodes by UK air date instead of iPlayer's numbers. |
| `DOWNLOAD_ASK_VERSION` | `true` | No | Ask which version (audio described / signed) to download or subscribe to. |
| `DOWNLOAD_DEFAULT_VERSION` | _(standard)_ | No | Version used when not asking: empty, `audio-described` or `signed`. |
| `PLAY_ASK_VERSION` | `true` | No | Ask which version to play (native client). |
| `PLAY_DEFAULT_VERSION` | _(standard)_ | No | Version played when not asking. |
| `LIBRARY_FOLDER_STRUCTURE` | `true` | No | Jellyfin-style `Show/Season/...` folder nesting. |
| `WRITE_NFO_STRM` | `manual` | No | `none` / `all` / `nzb` / `manual` — writes `.nfo` metadata. |
| `WRITE_STRMTOOL_JSON` | `false` | No | Also writes a `.strmtool.json` sidecar for `.strm` files (StrmTool Jellyfin plugin). Requires `WRITE_NFO_STRM` to be enabled. |
| `WRITE_NFO_CAST` | `true` | No | Lists the episode's cast, directors and writers (looked up on the BBC) in each `.nfo`. |
| `WRITE_NFO_EPISODE_TITLES` | `true` | No | Titles an episode called only "Episode N" with iPlayer's editorial headline in its `.nfo`. |
| `WRITE_NFO_RUNTIME_FALLBACK` | `true` | No | Takes a missing running time from iPlayer's listing API for the `.nfo`. |
| `WRITE_ADDITIONAL_IMAGES` | `missing` | No | `none` / `missing` / `overwrite`: extra Jellyfin images (episode picture; poster, backdrop, landscape, logo for the show or film). |
| `STRM_SECURE_ACTION` | `rename` | No | What happens to a `.strm` link once a subscription replaces it with a real download: `rename` (to `.bak`), `delete` or `leave`. |
| `TV_FILENAME_TEMPLATE` | see [CONFIG.md](CONFIG.md) | No | Handlebars template for flat TV filenames. |
| `MOVIE_FILENAME_TEMPLATE` | see [CONFIG.md](CONFIG.md) | No | Handlebars template for flat movie filenames. |
| `REFRESH_SCHEDULE` | `0 * * * *` | No | Cron expression for schedule refresh (edit it on Settings → Maintenance, with the other scheduled tasks). |
| `SCHEDULE_FULL_REFRESH` | `false` | No | Re-fetch every day in the window instead of caching passed days. |
| `RSS_FEED_HOURS` | `48` | No | Lookback window for the RSS feed endpoint (1-720). |
| `NATIVE_SEARCH` | `true` | No | Use BBC's native search API instead of `get_iplayer --search`. |
| `NATIVE_SEARCH_ENGINE` | `V2` | No | `V1` (original) or `V2` (concurrent lookups, retries); only used when `NATIVE_SEARCH` is on. |
| `NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY` | `false` | No | Engine V2: fetch only the requested season. Never applies to manual search. |
| `NATIVE_SEARCH_V2_EXPAND_COLLECTIONS` | `false` | No | Engine V2: a search for an iPlayer collection's pid or link lists its episodes/films. |
| `NATIVE_SEARCH_V2_COLLECTION_NAMES` | `false` | No | Engine V2: find iPlayer collections whose title matches (listed among the Search page results and type-ahead; their contents for Sonarr/Radarr searches). |
| `BROWSE_COLLECTION_SOURCES` | `all` | No | Where collections are collected from: `all` (home page and every category page) or `home` (home page only). |
| `BROWSE_SHOW_COLLECTIONS` | `true` | No | Show iPlayer collections on the Discover page. |
| `SEARCH_MATCH_ALL_WORDS` | `true` | No | Only list results containing every searched word. |
| `MANUAL_NATIVE_SEARCH` | `inherit` | No | Search-page override of `NATIVE_SEARCH` (`inherit`, `true`, `false`). |
| `MANUAL_NATIVE_SEARCH_ENGINE` | `inherit` | No | Search-page override of `NATIVE_SEARCH_ENGINE`. |
| `MANUAL_SEARCH_MATCH_ALL_WORDS` | `inherit` | No | Search-page override of `SEARCH_MATCH_ALL_WORDS`. |
| `MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS` | `inherit` | No | Search-page override of `NATIVE_SEARCH_V2_EXPAND_COLLECTIONS`. |
| `MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES` | `inherit` | No | Search-page override of `NATIVE_SEARCH_V2_COLLECTION_NAMES`. |
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
| `STREAM_SUBTITLES` | `true` | No | Offer the BBC's captions as an English subtitle track on native streams (on-demand and live). See [STREAMING.md](STREAMING.md#subtitles). |
| `LIVE_UHD_EVENT_FEEDS` | `false` | No | List BBC's UHD event feeds (`uk bbc stream 031`, `041`-`044`) among the live channels. DASH only, 2160p HEVC; they only carry video while an event is on. |
| `LIVE_RADIO` | `false` | No | Add BBC radio stations as audio-only live channels (library, Jellyfin Live TV). See [STREAMING.md](STREAMING.md#live-radio). |
| `STREAM_LIVE_DASH_1080` | `true` | No | Experimental: serve live channels as 1080p HEVC (BBC's DASH feed) in Direct mode (as HLS playlists, no ffmpeg) and Progressive MKV mode (ffmpeg). Falls back to 720p HLS. |
| `LIVE_STRM_DIR` | _(unset)_ | No | Where live channel `.strm` files are written; blank uses `COMPLETE_DIR`. |
| `LIVE_TV_ENABLED` | `true` | No | Serve the live channels as an M3U tuner + XMLTV guide for Jellyfin Live TV. See [STREAMING.md](STREAMING.md#jellyfin-live-tv-tuner--guide). |
| `LIVE_TV_EPG_OFFSET` | `0` | No | Minutes to shift the Live TV guide, on top of the server-timezone times. See [STREAMING.md](STREAMING.md#jellyfin-live-tv-tuner--guide). |
| `LIVE_TV_LOGO_SHAPE` | `landscape` | No | Live TV channel logo shape: `landscape` (16:9) or `square`. |
| `LIVE_TV_GUIDE_CATEGORIES` | `true` | No | Tag Live TV guide programmes with BBC categories (Movie/Sports/News/Kids) for Jellyfin's colours and filters. |
| `LIVE_TV_GUIDE_FLAGS` | `true` | No | Tag Live TV guide programmes as live / new / repeat. |
| `LIVE_TV_GUIDE_HD` | `true` | No | Mark Live TV guide programmes as HD. |
| `LIVE_TV_JELLYFIN_APPS` | _(unset)_ | No | Comma-separated Jellyfin app ids (from the Apps page) asked to refresh their guide when the Live TV channel list changes. Normally set by ticking servers in Settings. |
| `STRM_WATCHDOG_ENABLED` | `true` | No | Daily check that `.strm` links still resolve. See [WATCHDOG.md](WATCHDOG.md). |
| `STRM_WATCHDOG_SOURCES` | `history` | No | Comma-separated: `subscribed`, `history`, `app:<id>`. |
| `STRM_WATCHDOG_ACTION` | `notify` | No | `notify` or `delete` for an expired link. |
| `STRM_WATCHDOG_PATH_MAP` | _(unset)_ | No | Sonarr/Jellyfin path to in-container path, e.g. `/tv=/library/tv` (`;` separated). |
| `STRM_WATCHDOG_ARR_ACTION` | `none` | No | `none` / `unmonitor` / `search` in Sonarr/Radarr. |
| `STRM_WATCHDOG_CONCURRENCY` | `4` | No | Parallel checks, 1-10. |
| `STRM_WATCHDOG_FAIL_THRESHOLD` | `10` | No | Links that must validate before any action is taken; also the consecutive-failure outage cutoff. |
| `STRM_WATCHDOG_STRIKES` | `2` | No | Failed checks in a row before a link is invalid, 1-30. |
| `STRM_WATCHDOG_WEBHOOK_URL` | _(unset)_ | No | JSON `POST` when a link first becomes invalid. |
| `STRM_WATCHDOG_UPDATE_ROUTES` | `false` | No | Watchdog edits `.strm` files to carry the BBC route with the best picture. See [WATCHDOG.md](WATCHDOG.md). |
| `STRM_PROBE_ROUTE` | `false` | No | Ask BBC for the best route when a `.strm` link is created and note it in the link. |
| `THUMBNAIL_CACHE_DIR` | temp folder | No | Where cached BBC thumbnails are stored. |
| `THUMBNAIL_RETENTION_DAYS` | `30` | No | Thumbnail cache cleanup window. |
| `STREAM_HISTORY_RETENTION_DAYS` | `30` | No | Native stream history cleanup window. |
| `UI_PILL_COLORS` | `true` | No | Colour channel pills by logo (all browsers). |
| `UI_CHANNEL_TOOLS` | `true` | No | Show the arrange / library / Live TV / customise buttons on the Channels page. |
| `UI_INFO_MESSAGES` | `true` | No | Show the blue explanatory notes at the top of pages. |
| `UI_QUALITY_BADGES` | `true` | No | HDR / UHD badges on cards. |
| `UI_VERSION_BADGES` | `true` | No | Audio described / signed badges (also reveals the version settings). |
| `UI_SUBTITLE_BADGES` | `true` | No | Subtitles icon on episodes. |
| `UI_EXTENDED_DEBUG` | `false` | No | Library Debug button on the Watchdog page. |
| `UI_EXPIRY_BADGES` | `true` | No | "N days left" badge on episodes leaving iPlayer within 30 days. |
| `UI_GUIDANCE_BADGES` | `false` | No | Warning icon on episodes iPlayer lists with content guidance. |
| `HIDE_DONATE` | _(unset)_ | No | Hides the Ko-fi donate links in the UI. |
| `PUID` | `1000` | No | Host user ID the container runs as (`docker_entry.sh`). |
| `PGID` | `1000` | No | Host group ID the container runs as. |

**Process-level, not read through `configService` (set only via environment, never the Settings UI):**

| Variable | Default | Required? | Description |
| --- | --- | --- | --- |
| `PORT` | `4404` | No | HTTP port, read directly from `process.env` before the config store is available. |
| `DEBUG` | `false` | No | Verbose request logging + permissive CORS for local frontend-dev-server use. |
| `SECRETS_KEY` | _(unset)_ | No | Key used to encrypt stored credentials (app API keys, `API_KEY`, `STREAM_KEY`, OIDC secret) in the database. If unset a key file is generated. Keep it with your database backups; see [SECURITY.md](SECURITY.md). |
| `SECRETS_KEY_FILE` | `<CACHE_LOCATION>/secrets.key` | No | Where the generated encryption key file is stored when `SECRETS_KEY` is not set. |
| `SESSION_SECRET` | _(generated, kept in the database)_ | No | Secret used to sign login cookies. |
| `SESSION_COOKIE_SECURE` | `false` | No | Set `true` when the UI is only reached over HTTPS to mark the login cookie `Secure`. |
| `ALLOW_EMBEDDING` | `false` | No | Set `true` to allow the UI to be framed by other sites (dashboards). |
| `LOG_DIR` | `/logs` (Docker image) | No | Directory for rotated log files. |
| `NODE_ENV` | _(unset)_ | No | Set to `test` by the test runner to suppress file logging. |
| `DATABASE_URL` | `file:/config/iplayarr.db` (Docker) | No | SQLite database file. Env-only. |
| `CONFIG_LOCATION` | `/config`, else `./config` | No | Directory for `iplayarr.db` when `DATABASE_URL` is unset. |
| `REDIS_HOST` | _(unset)_ | No | Only for upgrading from a Redis-based version: set for the first start to import the old data, then remove. Also `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_SSL`. |

See [DATABASE.md](DATABASE.md) for the database and the one-time Redis import.
