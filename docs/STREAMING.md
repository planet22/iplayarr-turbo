# Streaming (`.strm` mode)

By default, iPlayarr downloads the full media file for every item before handing it to Sonarr/Radarr. Streaming mode instead writes a small `.strm` pointer file — Sonarr/Radarr (and your media server) see the item as "complete" immediately, and the actual video is only fetched when something plays the file.

## What you get

- Near-instant "downloads" — no waiting for a full file to transfer before the item shows as complete.
- Much lower disk usage — a `.strm` file is a few bytes; the media itself streams on demand instead of being stored.
- A choice of three stream clients, each with different tradeoffs (see below).

The tradeoff: playback needs iPlayarr (and your network path to it) to be up and reachable every time you watch, since there's no local copy.

## Prerequisites

- A media server that understands `.strm` files — Jellyfin, Plex, and Emby all support them.
- iPlayarr reachable from wherever that media server runs, on a stable address (see `STREAM_BASE_URL` below).
- `ffmpeg` on the `PATH` if you plan to use `STREAM_MODE=progressive-mkv` (not required for the default `direct` mode).

## Step 1 — turn on streaming mode

`MEDIA_MODE=strm` is the default (Settings → Media Management → Media Mode, or the `MEDIA_MODE` env var). Completed items are written as `.strm` files instead of downloaded media; set it to `download` if you'd rather fetch the full file every time.

## Step 2 — set the stream base URL and key

Under Settings → Streaming:

- **Stream Base URL** (`STREAM_BASE_URL`) — the address your media server uses to reach iPlayarr, e.g. `http://192.168.1.10:4404`. This gets baked into every `.strm` file's playback link.
- **Stream Key** (`STREAM_KEY`) — secures those playback links. It's separate from your `API_KEY` so you can regenerate it on its own (there's a regenerate button next to the field) if a link ever leaks, without having to re-key every other integration.

## Step 3 — choose a Stream Client

`STREAM_CLIENT` controls what actually resolves and serves the stream when a `.strm` file is opened:

| Value | What it does |
| --- | --- |
| `GET_IPLAYER` | Uses `get_iplayer --streaminfo` to resolve a playable URL. Reliable, but resolving is slow when a title has multiple available versions (audiodescribed, signed, etc. all get checked). Pins to your `VIDEO_QUALITY` setting. |
| `YTDLP` | Uses `yt-dlp` to resolve the stream. Also pins to `VIDEO_QUALITY`. |
| `NATIVE` (default) | Talks to BBC's streaming APIs directly, skipping `get_iplayer`/`yt-dlp` entirely. Fastest to start, and (in adaptive mode) lets the player pick its own quality rather than a fixed one. |

Native is recommended for most setups — it's the only client that resolves a single targeted playback path instead of walking every programme version, so playback starts noticeably faster.

**Using `YTDLP`** (for this or `DOWNLOAD_CLIENT`) in a container that drops to a non-root user (i.e. `PUID`/`PGID` set) needs `cap_add: [NET_BIND_SERVICE]` - see [INSTALLATION.md](INSTALLATION.md#puid--pgid) for why.

### Native-only settings

These only apply when `STREAM_CLIENT=NATIVE`:

- **Native Quality** (`STREAM_NATIVE_ADAPTIVE`, default off/Fixed) — Fixed pins playback to your `VIDEO_QUALITY` setting (recommended). Adaptive instead hands your player the full bitrate ladder so it adjusts quality to your connection automatically.
- **Native Quality Probe** (`STREAM_NATIVE_HQ_PROBE`, default off) — BBC doesn't always advertise a connection's real quality accurately. Enabling this checks the actual encoded quality of every candidate connection before picking one, which can find a genuinely higher-quality stream but adds a short delay before playback starts.
- **Native FHD Upgrade** (`STREAM_NATIVE_EXPERIMENTAL_FHD`, default on) — Attempts to unlock real 1080p on titles that have it, above BBC's usual 720p cap for this kind of access (recommended). Falls back to normal quality automatically if it doesn't work on a given title.

## Step 4 — choose a Stream Mode

`STREAM_MODE` controls how the resolved stream is actually served to the player:

- **Direct** (default) — passes the stream through as-is. Supports seeking. Recommended.
- **Progressive MKV** — remuxes the stream to MKV on the fly. Requires `ffmpeg` on the `PATH`, and does not support seeking within an in-progress stream. Only worth using if your player specifically needs an MKV container.

## Optional: stream cache directory

`STREAM_CACHE_DIR` is where temporary files live while a stream is in flight. Leave it blank to use a system temp folder, or point it at a specific directory if you want more control over where that scratch data lands.

## Live channels

Besides on-demand programmes, iPlayarr can stream the BBC's live channels: BBC One, Two, Three, Four, News, Parliament, CBBC, CBeebies, BBC Alba, BBC Scotland and S4C.

- **Watch live:** the Channels tiles and each channel page have a Play / Watch Live button that uses the in-app player. Live playback does not depend on `STREAM_CLIENT` (it has its own resolver) and needs a Stream Key, like any other playback.
- **In your media library:** press **+** on a channel tile (or **Add all**) and iPlayarr writes one `<Channel>.strm` into the **Live Channels Directory** (`LIVE_STRM_DIR`, Settings → Media Management; blank falls back to `COMPLETE_DIR`), plus a locked `.nfo` and a logo poster, so Jellyfin lists it as a channel. `STREAM_BASE_URL` must be set first. Manage them in the **Live channels** section of the Subscriptions page ([SUBSCRIPTIONS.md](SUBSCRIPTIONS.md#live-channels)).
- iPlayarr only rewrites or deletes the live files it created, and rewrites them all at server start so a changed Stream Base URL or Key does not leave dead links.
- The highest quality variant is listed first, so media servers probe and report 720p rather than the lowest listed.
- The Streaming page shows live sessions with the channel name and logo and a **Live** badge.
- The [STRM Watchdog](WATCHDOG.md) ignores live files.

### Jellyfin Live TV (tuner + guide)

Library `.strm` entries above show up as videos. To get a real channel list and TV guide in Jellyfin's **Live TV** section, enable **Settings → Streaming → Live TV (Jellyfin)** (`LIVE_TV_ENABLED`, off by default). It needs `STREAM_BASE_URL` set. Two URLs then appear, both secured by the Stream Key:

- **M3U Tuner URL** (`/api?mode=live_playlist&streamkey=...`): Jellyfin → Dashboard → Live TV → Tuner Devices → add an **M3U Tuner**.
- **XMLTV Guide URL** (`/api?mode=live_epg&streamkey=...`): Jellyfin → Dashboard → Live TV → TV Guide Data Providers → add **XMLTV**, then map channels (ids match the playlist).

Playback uses the existing live resolver, so it needs a UK IP, and the guide is built from the same iPlayer schedule as the Schedule page (yesterday to tomorrow). With the setting off the endpoints return 404 and nothing else changes. Channel logos are served as SVG under the same key (`mode=live_logo`); Jellyfin may ignore SVG logos.

## Checking links still work

Programmes expire from iPlayer. The optional [STRM Watchdog](WATCHDOG.md) checks daily that your `.strm` links still resolve and can report or remove dead ones.

## Testing it without downloading anything

Every search result, Queue/History row, and video info modal (opened from Queue, History, Streaming, NZB, or Video Events) has a Play icon / "Play Video" button that streams that item straight through the browser using whatever `STREAM_CLIENT`/`STREAM_MODE` is currently configured. It works regardless of `MEDIA_MODE` — a quick way to confirm your streaming settings actually resolve and play before relying on `.strm` mode for real.

## Field reference

| Setting | Default | Notes |
| --- | --- | --- |
| `MEDIA_MODE` | `strm` | Set to `download` to fetch the full file instead |
| `STREAM_BASE_URL` | _(unset)_ | Required for `.strm` files to resolve correctly |
| `STREAM_KEY` | _(generated)_ | Regenerate independently of `API_KEY` |
| `STREAM_CLIENT` | `NATIVE` | `GET_IPLAYER` / `YTDLP` / `NATIVE` |
| `STREAM_MODE` | `direct` | `direct` / `progressive-mkv` |
| `STREAM_CACHE_DIR` | temp folder | Advanced setting |
| `STREAM_NATIVE_ADAPTIVE` | `false` | Native client only |
| `STREAM_NATIVE_HQ_PROBE` | `false` | Native client only |
| `STREAM_NATIVE_EXPERIMENTAL_FHD` | `true` | Native client only |
| `LIVE_STRM_DIR` | _(unset)_ | Where live channel `.strm` files are written; blank uses `COMPLETE_DIR` |
| `STREAM_HISTORY_RETENTION_DAYS` | `30` | How long native streaming session history is kept before nightly cleanup |

See [TURBO.md](../TURBO.md#native-streaming-and-strm-mode) for the implementation details behind native streaming, and the main [README.md](../README.md) for the full settings list.
