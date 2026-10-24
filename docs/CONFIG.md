# Settings reference

Every runtime setting in iPlayarr is an `IplayarrParameter` (`src/types/IplayarrParameters.ts`), read through `configService.getParameter`. Precedence is:

1. Value set via the Settings UI (persisted in the database)
2. The matching environment variable
3. A built-in default, if one exists (`configService.ts`'s `defaultConfigMap`)

Not every parameter has a built-in default — some (`DOWNLOAD_DIR`, `COMPLETE_DIR`, `API_KEY`, `STREAM_KEY`, `STREAM_BASE_URL`, the `OIDC_*` fields) are either required or only meaningful once you've set them. `API_KEY` and `STREAM_KEY` are the two exceptions that auto-generate on first server start if unset (`src/server.ts`) rather than being left blank.

This is the master field reference. For step-by-step setup guides, see [STREAMING.md](STREAMING.md) and [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md); for a flat env-var lookup table, see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

Settings UI fields marked "Advanced" only appear after clicking the advanced-settings cog in the Settings page toolbar. The cog shows a tick while advanced settings are on, and the choice is remembered in this browser.

## Using the Settings page

- **Tabs:** General, Media Management, Download Client, Streaming, Live TV, Authentication and Maintenance. The open tab is kept in the URL (`/settings#streaming`), so it can be bookmarked or linked, and Back/forward switch tabs.
- **Save bar:** nothing applies until you save. A sticky bar shows "N unsaved changes" with **Discard** and **Save**. Edited fields, the tab that holds them and the Save button are highlighted in amber. Save applies the open tab; switching away from a tab with edits, leaving the page, or closing/reloading the browser asks first. The bar also covers edits to scheduled-task times, cache lifetimes and the per-browser Appearance choices.
- **Filter box:** the box in the toolbar hides settings on the open tab that do not match what you type (and any section heading left empty).
- **(i) buttons:** field descriptions are behind an (i) button beside each field (hover, focus or tap).
- **Number settings** have a minimum and maximum in the form and are validated on the server (table below). A stored or environment value outside its range is pulled back into range when read, so a value left by an older version cannot stop you saving.
- **Quick find:** `Ctrl+K` (`Cmd+K` on a Mac) opens a palette that jumps to any page or Settings tab, suggests programmes and runs a plain search. See [USAGE_GUIDE.md](USAGE_GUIDE.md#quick-find).

| Setting | Allowed range |
| --- | --- |
| `ACTIVE_LIMIT` | 1-10 |
| `RSS_FEED_HOURS` | 1-720 |
| `STREAM_HISTORY_RETENTION_DAYS` | 1-3650 |
| `STRM_WATCHDOG_CONCURRENCY` | 1-10 |
| `STRM_WATCHDOG_FAIL_THRESHOLD` | 1-1000 |

## General (Settings → General)

Sections: Access, NZB Search, Manual Search, Appearance and (advanced) Schedule.

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Api Key | `API_KEY` | _(auto-generated)_ | Secures the Newznab/SABnzbd API surface (`?apikey=`). Regenerate from the field's button; Settings will offer to push the new key out to configured Apps. |
| Native Search | `NATIVE_SEARCH` | `true` | Queries BBC's own search API + local Lunr re-ranking (`NativeSearchService`) instead of shelling out to `get_iplayer --search`. Toggling it clears the search cache. |
| Native Search Engine _(advanced)_ | `NATIVE_SEARCH_ENGINE` | `V1` | Only shown when Native Search is on. `V1` ("1.0") is the stable engine. `V2` ("2.0", experimental) looks hits up concurrently, fetches episode details several at a time, retries failed episode-list pages and pages nested series; results should be identical, so switch back if anything looks wrong. |
| Requested Series Only _(advanced)_ | `NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY` | `false` | Engine 2.0 only. Fetch just the season Sonarr/Radarr asks for, which is faster for long shows. Not used with synonyms or Airdate Numbering. Never applies to manual search. |
| Match All Words _(advanced)_ | `SEARCH_MATCH_ALL_WORDS` | `true` | Only list results containing every word searched for. Turn off for looser matching. |
| Manual Search overrides | `MANUAL_NATIVE_SEARCH`, `MANUAL_NATIVE_SEARCH_ENGINE`, `MANUAL_SEARCH_MATCH_ALL_WORDS` | `inherit` | The Native Search, engine and Match All Words settings above are the NZB search settings (used by Sonarr/Radarr). These twins apply to manual search on the Search page only; `inherit` ("Same as NZB search") follows the setting above, so you can try a different engine by hand without changing what Sonarr/Radarr get. Manual results are cached separately when the settings differ. The Search page shows the active manual setup below its results, with a link to Settings. |
| Items Before Paging _(advanced, per browser)_ | _(browser only)_ | `4` | A list shows page controls only when it has more items than this (0-1000); `0` always shows them. |
| Hours in RSS Feed _(advanced)_ | `RSS_FEED_HOURS` | `48` | How far back the RSS feed endpoint looks (1-720). |
| Full Schedule Refresh _(advanced)_ | `SCHEDULE_FULL_REFRESH` | `false` | `false` reuses cached results for days in the schedule window that have already fully passed; `true` re-fetches every day on every refresh. |

`REFRESH_SCHEDULE` (the cron expression for the proactive BBC schedule refresh) now lives on the Maintenance tab with the other [scheduled tasks](#maintenance-settings--maintenance).

### Appearance

Settings named `UI_*` are stored with the rest of the configuration and apply to **every browser** that opens this iPlayarr. The others are per browser (`localStorage`). All of them only apply on Save. See [THEMING.md](THEMING.md).

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Colour Scheme / Colour Mode | _(per browser)_ | iPlayarr / Match system | Six schemes, each with a dark and a light version. The sun/monitor/moon switch in the top bar changes the mode at once. |
| Top Bar | _(per browser)_ | Slim | Slim keeps the bar on screen while scrolling; Hide on scroll shows it again when you scroll up. |
| Show Quick Find Button | _(per browser)_ | on | The lightning-bolt button in the top bar. `Ctrl+K` / `Cmd+K` works either way. |
| Show Info Messages | `UI_INFO_MESSAGES` | `true` | The blue explanatory notes at the top of pages. Warnings and errors always show. |
| Colour Channel Pills | `UI_PILL_COLORS` | `true` | Colour channel labels to match each BBC logo. |
| Show Channel Tools | `UI_CHANNEL_TOOLS` | `false` | The arrange, library, Live TV and customise buttons on the Channels page. Off keeps the page simple. |
| Show HDR / UHD Badge _(advanced)_ | `UI_QUALITY_BADGES` | `false` | A badge where iPlayer lists HDR or Ultra HD. It is only a label: iPlayarr streams HD at most. |
| Show Audio Described / Signed Badge _(advanced)_ | `UI_VERSION_BADGES` | `false` | Marks programmes and episodes that have an audio described or signed version. Also reveals the Versions settings. |
| Show Subtitle Badge _(advanced)_ | `UI_SUBTITLE_BADGES` | `false` | A subtitles icon on episodes. Not checked per programme: the BBC gives most of them subtitles. |

Debug logging is controlled by the `DEBUG` env var (default `false`) — not exposed in the Settings UI, since it also flips permissive CORS for local frontend-dev-server use (`src/server.ts`). Set it in the container/process environment, not via Settings.

`PORT` (default `4404`) is also env-only, read directly from `process.env` at startup before configService/the database are available.

## Authentication (Settings → Authentication)

See [AUTHENTICATION.md](AUTHENTICATION.md) for full behavior. Field summary:

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Authentication Enabled? (`AUTH_TYPE`) | `AUTH_TYPE` | `form` | `form` (username/password), `oidc` (OpenID Connect), or `none` (no login). |
| Username | `AUTH_USERNAME` | `admin` | Only shown/used when `AUTH_TYPE=form`. |
| Password | `AUTH_PASSWORD` | _(none — generated on first start)_ | Stored as a bcrypt hash; legacy MD5 hashes are transparently upgraded to bcrypt on next successful login. With no password set (or the retired `admin` / `password` default) a random one is generated on start and printed once in the log; see [AUTHENTICATION.md](AUTHENTICATION.md#upgrading-from-an-older-version). |
| OIDC Configuration URL | `OIDC_CONFIG_URL` | _(unset)_ | OIDC discovery/config URL. Required when `AUTH_TYPE=oidc`. |
| OIDC Callback Host | `OIDC_CALLBACK_HOST` | _(unset)_ | Must match what you register as the callback URL with your OIDC provider (`<host>/auth/oidc/callback`). |
| OIDC Client ID | `OIDC_CLIENT_ID` | _(unset)_ | Required when `AUTH_TYPE=oidc`. |
| OIDC Client Secret | `OIDC_CLIENT_SECRET` | _(unset)_ | Required when `AUTH_TYPE=oidc`. |
| OIDC Allowed Emails | `OIDC_ALLOWED_EMAILS` | _(unset)_ | Comma-separated allow-list; a successful OIDC login is still rejected if the authenticated email isn't in this list. |

## Download Client (Settings → Download Client)

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Download Limit | `ACTIVE_LIMIT` | `3` | Max simultaneous downloads, 1-10. The queue never runs fewer than one at a time. |
| Download Client? | `DOWNLOAD_CLIENT` | `NATIVE` | `NATIVE`, `GET_IPLAYER` or `YTDLP` (experimental) — which tool actually performs full downloads (`AbstractDownloadService` implementations). `NATIVE` (the default and the fastest) resolves the BBC stream itself and has ffmpeg copy it to a file, so no get_iplayer/yt-dlp is spawned; it doesn't embed subtitles or resume an interrupted download yet, so pick `GET_IPLAYER` if you need those. `YTDLP` in a non-root container needs `cap_add: [NET_BIND_SERVICE]` - see the note under [Stream Client](#streaming-settings--streaming) below. |
| Additional Download Parameters _(advanced)_ | `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` | _(unset)_ | Extra CLI parameters appended to the `get_iplayer` download invocation. |
| Ask Which Version _(advanced)_ | `DOWNLOAD_ASK_VERSION` | `true` | Shown once the Audio Described / Signed badge setting is on. When an item has an audio described or signed version, ask which to download or subscribe to. Off uses the Default Version wherever the item has it. See [Versions](#versions-audio-described-and-signed). |
| Default Version _(advanced)_ | `DOWNLOAD_DEFAULT_VERSION` | _(standard)_ | Used when Ask is off and pre-selected when it is on. Items without that version download as the standard one. |
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
| Additional Qualities | `EXTRA_VIDEO_QUALITIES` | _(empty)_ | Offer these qualities as extra search results too, so Sonarr/Radarr can choose between them. Empty offers only the Video Quality. |
| Additional Versions | `EXTRA_VERSIONS` | _(empty)_ | Also list these programme versions (audio described, signed) as separate releases tagged in the name (`...AUDIO.DESCRIBED.WEBDL...`). Only programmes that have the version get a variant. Match the tag with a Sonarr/Radarr Custom Format. See [Versions](#versions-audio-described-and-signed). |
| Release Language _(advanced)_ | `RELEASE_LANGUAGE` | `none` | Adds a language tag such as `ENGLISH` to release names. Use it if Sonarr/Radarr shows an Unknown language and will not grab. |
| Airdate Numbering _(advanced)_ | `AIRDATE_NUMBERING` | `false` | Number episodes by UK air date (TheTVDB) instead of iPlayer's numbers; falls back to iPlayer's if nothing matches. Changing it clears the episode-details and search caches. |
| Output Format? | `OUTPUT_FORMAT` | `mp4` | `mp4` or `mkv`. |
| Archive Downloads? | `ARCHIVE_ENABLED` | `false` | Keep cancelled/removed queue and history items instead of discarding them. See `src/facade/downloadFacade.ts` and `historyService.addArchive`. |
| Organize into Folder Structure? | `LIBRARY_FOLDER_STRUCTURE` | `true` | Jellyfin-style `Show/Season NN/...` and `Movie/...` nesting under `COMPLETE_DIR`. See [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md). |
| Live Channels Directory | `LIVE_STRM_DIR` | _(unset)_ | Where `.strm` files for live channels added to the library are written; point a Jellyfin library at it. Blank uses `COMPLETE_DIR`. See [STREAMING.md](STREAMING.md#live-channels). |
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
| Native Subtitles | `STREAM_SUBTITLES` | `false` | Native client, Direct mode. Adds the BBC's captions as an English subtitle track, for on-demand and live. See [STREAMING.md](STREAMING.md#subtitles). |
| UHD Event Feeds | `LIVE_UHD_EVENT_FEEDS` | `false` | Native client. Lists BBC's UHD event feeds (`uk bbc stream 031`, `041`-`044`: up to 2160p HEVC, DASH only) among the live channels. They only carry video while a big event is on; between events they are listed but do not play. Needs a UK IP and a player (or Jellyfin transcoder) that handles 4K HEVC. Turning it off removes any subscribed feeds from the library (their `.strm` files are deleted) and from Jellyfin Live TV; the UI asks first. |
| Live 1080p (Experimental) | `STREAM_LIVE_DASH_1080` | `false` | Native client. Live channels as 1080p HEVC (BBC's DASH feed, mediaset `iptv-mse`) instead of 720p HLS, in both Direct and Progressive MKV modes. Direct mode presents the feed as HLS playlists and proxies BBC's segments untouched (no ffmpeg); Progressive MKV mode needs ffmpeg. Needs a player that decodes HEVC; subtitles are not offered on these channels. Falls back to 720p HLS if BBC offers no DASH for the channel. |
| Ask Which Version to Play _(advanced)_ | `PLAY_ASK_VERSION` | `true` | Native client, once the Audio Described / Signed badge setting is on. The Play button asks which version to play when there is more than one. Off plays the default below. The player can switch version either way. |
| Default Version to Play _(advanced)_ | `PLAY_DEFAULT_VERSION` | _(standard)_ | Used when Ask is off and pre-selected when it is on. |
| Stream Mode | `STREAM_MODE` | `direct` | `direct` or `progressive-mkv` (needs `ffmpeg`). |
| Stream Cache Directory _(advanced)_ | `STREAM_CACHE_DIR` | temp folder | Scratch space for in-flight streams. |
| — | `THUMBNAIL_CACHE_DIR` | temp folder | Where cached BBC episode thumbnails are stored. Env-only. |

## Live TV (Settings → Live TV)

Jellyfin Live TV tuner (M3U) and guide (XMLTV). Full walkthrough in [STREAMING.md](STREAMING.md#jellyfin-live-tv-tuner--guide). Needs `STREAM_BASE_URL` and a Stream Key.

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Live TV | `LIVE_TV_ENABLED` | `false` | Enables the tuner and guide endpoints and shows the tuner/guide URLs. |
| EPG Time Offset | `LIVE_TV_EPG_OFFSET` | `0` | Minutes to shift the guide (whole number, -1440 to 1440). Guide times are already in the server's timezone. |
| Channel Logo Shape | `LIVE_TV_LOGO_SHAPE` | `landscape` | `landscape` (16:9, suits guide cards) or `square` (suits channel tiles). Save and Update the tuner after changing. |
| Guide Categories | `LIVE_TV_GUIDE_CATEGORIES` | `true` | Tag programmes with their BBC category (plus Movie/Sports/News/Kids) for Jellyfin's colours and filters. |
| Live / New / Repeat Flags | `LIVE_TV_GUIDE_FLAGS` | `true` | Tag programmes as live, new or repeat. |
| HD Indicator | `LIVE_TV_GUIDE_HD` | `true` | Mark every programme as HD. |
| Jellyfin Servers | `LIVE_TV_JELLYFIN_APPS` | _(unset)_ | Jellyfin apps used for Live TV: shown with Add/Remove buttons and refreshed when the channel list changes. |

## STRM Watchdog (Settings → Streaming)

Daily check that `.strm` links still resolve on BBC. Off by default; all fields are documented in [WATCHDOG.md](WATCHDOG.md#settings): `STRM_WATCHDOG_ENABLED`, `STRM_WATCHDOG_SOURCES`, `STRM_WATCHDOG_ACTION`, `STRM_WATCHDOG_PATH_MAP`, `STRM_WATCHDOG_ARR_ACTION`, `STRM_WATCHDOG_CONCURRENCY`, `STRM_WATCHDOG_FAIL_THRESHOLD`, `STRM_WATCHDOG_WEBHOOK_URL`.

## Versions (audio described and signed)

Some programmes have an **audio described** or **signed** version alongside the standard one. iPlayarr treats each as a separate version of the same programme:

- **Sonarr/Radarr:** with **Additional Versions** set, search adds a tagged variant (for example `...AUDIO.DESCRIBED.WEBDL...`) only for programmes that have it. The version travels through the NZB, queue entry, `.strm` link (`?version=`) and the native and `get_iplayer` downloaders. `yt-dlp` refuses a versioned grab. BBC serves audio described at up to 540p (396p on some feeds), so its releases are named and capped at the quality it really has.
- **Manual download:** the Search page has version filters, results carry version badges, and the download dialog shows version and quality. Batch downloads (programme page, Search multi-select), quick downloads and download-by-URL ask which version, or use the default.
- **Subscriptions:** can also download the audio described / signed version of new episodes. See [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md#versions).
- **Play:** the Play button asks for, or defaults to, a version and the in-app player has a version switcher that resumes at the same position.
- **Badges:** Settings → General → Appearance. Programme-page answers are cached and the rest are fetched in the background, and only when the badge setting is on.

## Maintenance (Settings → Maintenance)

- **Rebuild Logos:** redraws every live channel logo, rewrites library posters and asks Jellyfin to refresh.
- **Caches:** BBC data is cached in the database so repeat searches and page loads are fast. Each cache row shows its item count and size, an editable **Keep for** lifetime (minutes to months, with Reset to default), and a **Clear** button; the toolbar has **Refresh** and **Clear All** (with confirmation). Caches are ordered by what they hold: browse, BBC programme data, search and schedule feeds, Skyhook, then streaming. A new lifetime applies to entries stored from then on; existing entries keep their old expiry until cleared. Thumbnails and **Stream History** (`STREAM_HISTORY_RETENTION_DAYS`) are managed here too. Hit rates are on the [Statistics](USAGE_GUIDE.md#statistics-stats) page.
- **Scheduled tasks:** every cron job is listed in run order with its next run time, a **Run now** button and an editable cron expression (**Validate** checks it, **Reset to default** restores the built-in one). Edits are drafts applied by Save and take effect without a restart. Some tasks enforce a minimum interval so they cannot be set to hammer the BBC.

| Task | Default schedule | Minimum interval | What it does |
| --- | --- | --- | --- |
| Schedule refresh (`REFRESH_SCHEDULE`) | `0 * * * *` | 15 min | Refreshes the schedule cache, recaches series metadata, clears stuck failed downloads |
| Guide refresh | `25 */6 * * *` | 60 min | Re-fetches the BBC schedules behind the Jellyfin guide before their cache expires |
| Subscriptions check | `17 * * * *` | 15 min | Checks all subscriptions for new episodes and queues them |
| Thumbnail cleanup | `35 3 * * *` | - | Deletes cached thumbnails not viewed recently |
| Stream history cleanup | `40 3 * * *` | - | Deletes stream history past its retention period |
| Library cleanup | `45 3 * * *` | - | Removes empty Show/Season folders left after import |
| Expired cache purge | `50 3 * * *` | - | Deletes expired entries from the database cache |
| STRM Watchdog | `15 4 * * *` | 60 min | Checks that `.strm` links still resolve ([WATCHDOG.md](WATCHDOG.md)) |

## Archive & Retention (Settings → Maintenance / Media Management)

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| Archive Downloads? | `ARCHIVE_ENABLED` | `false` | See Media Management, above. |
| Thumbnail Cache Retention (Days) | `THUMBNAIL_RETENTION_DAYS` | `30` | Nightly cleanup (3:35am) deletes cached thumbnails unused past this many days. "Run Thumbnail Cleanup Now" button triggers it on demand. |
| Stream History Retention (Days) | `STREAM_HISTORY_RETENTION_DAYS` | `30` | Nightly cleanup (3:40am) deletes native streaming session history past this many days. Also has a manual "Run Now" button. |

## Database (env-only — not in the Settings UI)

See [DATABASE.md](DATABASE.md) for full detail. Read directly from `process.env` in `src/service/db/prismaService.ts`, not through `configService`.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:/config/iplayarr.db` (Docker) | SQLite file location. |
| `CONFIG_LOCATION` | `/config`, else `./config` | Directory for `iplayarr.db` when `DATABASE_URL` is unset. |
