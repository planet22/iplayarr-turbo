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

Set `MEDIA_MODE=strm` (Settings → Media Management → Media Mode, or the `MEDIA_MODE` env var). Completed items are now written as `.strm` files instead of downloaded media.

## Step 2 — set the stream base URL and key

Under Settings → Streaming:

- **Stream Base URL** (`STREAM_BASE_URL`) — the address your media server uses to reach iPlayarr, e.g. `http://192.168.1.10:4404`. This gets baked into every `.strm` file's playback link.
- **Stream Key** (`STREAM_KEY`) — secures those playback links. It's separate from your `API_KEY` so you can regenerate it on its own (there's a regenerate button next to the field) if a link ever leaks, without having to re-key every other integration.

## Step 3 — choose a Stream Client

`STREAM_CLIENT` controls what actually resolves and serves the stream when a `.strm` file is opened:

| Value | What it does |
| --- | --- |
| `GET_IPLAYER` (default) | Uses `get_iplayer --streaminfo` to resolve a playable URL. Reliable, but resolving is slow when a title has multiple available versions (audiodescribed, signed, etc. all get checked). Pins to your `VIDEO_QUALITY` setting. |
| `YTDLP` | Uses `yt-dlp` to resolve the stream. Also pins to `VIDEO_QUALITY`. |
| `NATIVE` | Talks to BBC's streaming APIs directly, skipping `get_iplayer`/`yt-dlp` entirely. Fastest to start, and (in adaptive mode) lets the player pick its own quality rather than a fixed one. |

Native is recommended for most setups — it's the only client that resolves a single targeted playback path instead of walking every programme version, so playback starts noticeably faster.

### Native-only settings

These only apply when `STREAM_CLIENT=NATIVE`:

- **Native Quality** (`STREAM_NATIVE_ADAPTIVE`, default on) — Adaptive hands your player the full bitrate ladder so it adjusts quality to your connection automatically (recommended). Turning this off pins playback to your `VIDEO_QUALITY` setting instead, like the other two clients.
- **Native Quality Probe** (`STREAM_NATIVE_HQ_PROBE`, default off) — BBC doesn't always advertise a connection's real quality accurately. Enabling this checks the actual encoded quality of every candidate connection before picking one, which can find a genuinely higher-quality stream but adds a short delay before playback starts.
- **Native FHD Upgrade** (`STREAM_NATIVE_EXPERIMENTAL_FHD`, default off) — **Experimental.** Attempts to unlock real 1080p on titles that have it, above BBC's usual 720p cap for this kind of access. Falls back to normal quality automatically if it doesn't work on a given title, but it's unsupported and relies on behavior that could change without notice on BBC's end.

## Step 4 — choose a Stream Mode

`STREAM_MODE` controls how the resolved stream is actually served to the player:

- **Direct** (default) — passes the stream through as-is. Supports seeking. Recommended.
- **Progressive MKV** — remuxes the stream to MKV on the fly. Requires `ffmpeg` on the `PATH`, and does not support seeking within an in-progress stream. Only worth using if your player specifically needs an MKV container.

## Optional: stream cache directory

`STREAM_CACHE_DIR` is where temporary files live while a stream is in flight. Leave it blank to use a system temp folder, or point it at a specific directory if you want more control over where that scratch data lands.

## Testing it without downloading anything

Every search result, Queue/History row, and video info modal (opened from Queue, History, Streaming, NZB, or Video Events) has a Play icon / "Play Video" button that streams that item straight through the browser using whatever `STREAM_CLIENT`/`STREAM_MODE` is currently configured. It works regardless of `MEDIA_MODE` — a quick way to confirm your streaming settings actually resolve and play before relying on `.strm` mode for real.

## Field reference

| Setting | Default | Notes |
| --- | --- | --- |
| `MEDIA_MODE` | `download` | Set to `strm` to enable streaming mode |
| `STREAM_BASE_URL` | _(unset)_ | Required for `.strm` files to resolve correctly |
| `STREAM_KEY` | _(generated)_ | Regenerate independently of `API_KEY` |
| `STREAM_CLIENT` | `GET_IPLAYER` | `GET_IPLAYER` / `YTDLP` / `NATIVE` |
| `STREAM_MODE` | `direct` | `direct` / `progressive-mkv` |
| `STREAM_CACHE_DIR` | temp folder | Advanced setting |
| `STREAM_NATIVE_ADAPTIVE` | `true` | Native client only |
| `STREAM_NATIVE_HQ_PROBE` | `false` | Native client only |
| `STREAM_NATIVE_EXPERIMENTAL_FHD` | `false` | Native client only, experimental |
| `STREAM_HISTORY_RETENTION_DAYS` | `30` | How long native streaming session history is kept before nightly cleanup |

See [TURBO.md](../TURBO.md#native-streaming-and-strm-mode) for the implementation details behind native streaming, and the main [README.md](../README.md) for the full settings list.
