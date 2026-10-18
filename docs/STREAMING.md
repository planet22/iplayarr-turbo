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
- **Native Subtitles** (`STREAM_SUBTITLES`, default off) — Offers the BBC's subtitles as a selectable track, for on-demand programmes and live channels. See [Subtitles](#subtitles).
- **Live 1080p (Experimental)** (`STREAM_LIVE_DASH_1080`, default off) — BBC only offers live channels as 1080p through a DASH (HEVC) feed, not HLS. With this on and Stream Mode set to Progressive MKV, ffmpeg reads that feed directly. Direct mode stays at 720p unless **Live 1080p in Direct Mode** (next) is also on. Falls back to 720p HLS if the channel has no DASH feed.
- **Live 1080p in Direct Mode (Experimental)** (`STREAM_LIVE_DASH_BRIDGE`, default off) — Extends Live 1080p to Direct mode. BBC's DASH feed uses fMP4 segments, which HLS can play as they are, so iPlayarr only writes HLS playlists for it (a master plus video and audio playlists) and proxies BBC's segments through the usual segment proxy: no ffmpeg, no re-encoding, nothing on disk. HEVC support depends on the player. Subtitles are not offered on these channels, and if the feed cannot be presented the channel plays as normal 720p HLS.

## Step 4 — choose a Stream Mode

`STREAM_MODE` controls how the resolved stream is actually served to the player:

- **Direct** (default) — passes the stream through as-is. Supports seeking. Recommended.
- **Progressive MKV** — remuxes the stream to MKV on the fly. Requires `ffmpeg` on the `PATH`, and does not support seeking within an in-progress stream. Only worth using if your player specifically needs an MKV container.

## Optional: stream cache directory

`STREAM_CACHE_DIR` is where temporary files live while a stream is in flight. Leave it blank to use a system temp folder, or point it at a specific directory if you want more control over where that scratch data lands.

## Subtitles

The BBC's HLS streams carry no subtitles of their own; the captions are published separately. With **Native Subtitles** (`STREAM_SUBTITLES`) turned on in Settings → Streaming, iPlayarr fetches them, converts them to WebVTT and adds them to the stream as an **English** subtitle track. The track is **off by default** in the player, so nothing appears until you choose it.

- **Off by default, and additive.** With the setting off, streams are served exactly as before. If a programme has no captions, or fetching or converting them fails, you simply get the stream without a subtitle track.
- **Needs** `STREAM_CLIENT=NATIVE` and `STREAM_MODE=direct`. Progressive MKV output has no subtitle track.
- **On-demand programmes:** one caption file per programme, when the BBC has published captions for it.
- **Live channels:** the BBC publishes live captions as one small fragment per video segment; iPlayarr mirrors the video's own segment window, so the track follows the live edge. Captions lag the picture slightly, as live captions always do.
- **Pinned quality (`STREAM_NATIVE_ADAPTIVE=false`):** the stream is a single quality, which has nowhere to attach a track, so it is served as a one-quality master playlist that carries the subtitles. Players treat it the same.
- **Players:** anything that plays HLS and reads WebVTT subtitle tracks (the in-app player, hls.js based players). Caption times are written on the video's own timeline, so players that honour the playlist's timestamp map and ffmpeg-based software (which ignores it) both agree.
- **Streaming page:** a **Subs** column records whether the setting was on when each stream started (On/Off). It is the setting at the time, not a confirmation that the programme had captions. Streams from before the column existed show it blank.

### Jellyfin

- **On-demand `.strm` items work.** Jellyfin sees an English WebVTT stream when it probes the item and extracts it for its own subtitle menu. Jellyfin only learns of the track when it probes an item, so items it already probed **before** you enabled the setting won't show the track until Jellyfin probes them again (for example by refreshing their metadata). The same applies in reverse: Jellyfin keeps what it learned and the subtitle it extracted, so turning the setting off later leaves a track on already-probed items until they are refreshed.
- **Live TV does not offer the track.** Jellyfin's Live TV pipeline drops embedded subtitle streams from tuner channels (the stream it opens lists video and audio only, and its transcode runs with subtitles disabled), so live captions do not appear in Jellyfin's own Live TV, even though the stream carries them. Playback is unaffected. Live captions do work in the in-app player.

## Live channels

Besides on-demand programmes, iPlayarr can stream the BBC's live channels: BBC One, Two, Three, Four, News, Parliament, CBBC, CBeebies, BBC Alba, BBC Scotland and S4C.

- **Watch live:** the Channels tiles and each channel page have a Play / Watch Live button that uses the in-app player. Live playback does not depend on `STREAM_CLIENT` (it has its own resolver) and needs a Stream Key, like any other playback.
- **In your media library:** press **+** on a channel tile (or **Add all**) and iPlayarr writes one `<Channel>.strm` into the **Live Channels Directory** (`LIVE_STRM_DIR`, Settings → Media Management; blank falls back to `COMPLETE_DIR`), plus a locked `.nfo` and a logo poster, so Jellyfin lists it as a channel. `STREAM_BASE_URL` must be set first. Manage them in the **Live channels** section of the Subscriptions page ([SUBSCRIPTIONS.md](SUBSCRIPTIONS.md#live-channels)).
- iPlayarr only rewrites or deletes the live files it created, and rewrites them all at server start so a changed Stream Base URL or Key does not leave dead links.
- The highest quality variant is listed first, so media servers probe and report 720p rather than the lowest listed.
- The Streaming page shows live sessions with the channel name and logo and a **Live** badge.
- With **Native Subtitles** on, live channels carry an English subtitle track too (see [Subtitles](#subtitles)).
- The [STRM Watchdog](WATCHDOG.md) ignores live files.

### Jellyfin Live TV (tuner + guide)

Library `.strm` entries above show up as videos. To get a real channel list and TV guide in Jellyfin's **Live TV** section, enable **Settings → Live TV** (`LIVE_TV_ENABLED`, off by default). It needs `STREAM_BASE_URL` set (the Live TV tab shows the Stream Base URL and Stream Key fields too, unless `MEDIA_MODE=strm`, where they are on the Streaming tab). With the setting off, the endpoints return 404 and the TV buttons are hidden.

**Pick channels.** Only channels you select are offered to Jellyfin, in both the tuner and the guide (nothing selected means an empty tuner). On the Channels page press **Edit**, then use the **TV icon** on a channel's tile or **Live TV all**; press **Done** when finished. Outside Edit mode the tiles and a channel's own page only show read-only TV (in Live TV) and bell (in your library) status icons. Channel numbers are fixed per channel, so they don't shuffle as you add and remove channels.

**Add it to Jellyfin.** Either press the buttons in the Live TV section, or paste the two URLs yourself (both are secured by the Stream Key):

- **Jellyfin Servers** is a tick list of the Jellyfin servers from the Apps page (each needs an *administrator* API key); tick as many as you like. Each ticked server gets its own block (the tick list is saved with your settings), where **Channels (M3U tuner)** and **Guide (XMLTV)** each have their own **Add/Update** and **Remove** buttons, so the tuner and the guide can be managed separately. Only entries pointing at iPlayarr are touched; your other tuners and guide providers are left alone. Adding the guide also asks Jellyfin to refresh it. These buttons use the *saved* settings, so save first, and press Update again if you change the Stream Base URL or Stream Key.
- By hand: **M3U Tuner URL** (`/api?mode=live_playlist&streamkey=...`) under Dashboard → Live TV → Tuner Devices → M3U Tuner, and **XMLTV Guide URL** (`/api?mode=live_epg&streamkey=...`) under TV Guide Data Providers → XMLTV.

**Keeping Jellyfin in step.** The playlist and guide always reflect your current selection. A few seconds after you last add or remove a channel, iPlayarr asks every Jellyfin server ticked in **Jellyfin Servers** to refresh its guide, which also re-reads the tuner. The tick list is a normal setting, so save settings to keep it. It's best-effort: if a server is unreachable the change still saves (and the other servers are still refreshed), and that server catches up at its next scheduled Refresh Guide. A Jellyfin server you added by pasting the URLs in by hand isn't in the list, so run Refresh Guide there (Dashboard → Scheduled Tasks) after changing channels.

**Guide times.** The guide comes from the same iPlayer schedule as the Schedule page and covers yesterday through the next six days (7 days ahead, matching what Jellyfin asks for). Times are written as wall-clock time in the timezone iPlayarr runs in (`TZ`, with its real UTC offset), so "live now" lines up. If Jellyfin still shows the guide early or late, set **EPG Time Offset** (`LIVE_TV_EPG_OFFSET`, minutes, default `0`).

**Programme images and logos.** Each guide entry carries the programme's image. Channel logos are served as hi-res PNGs under the same key (`mode=live_logo`); **Channel Logo Shape** (`LIVE_TV_LOGO_SHAPE`) picks `landscape` (16:9, default, suits Jellyfin's guide cards) or `square` (suits its channel tiles). After changing it, save and press Update on the tuner.

**Guide options.** Three switches (all on by default) control the extra tags written into the guide so Jellyfin can colour and filter it:

- **Guide Categories** (`LIVE_TV_GUIDE_CATEGORIES`) - tags each programme with its BBC category, plus Movie / Sports / News / Kids where they apply, for Jellyfin's colours and category filters.
- **Live / New / Repeat Flags** (`LIVE_TV_GUIDE_FLAGS`) - marks programmes as live, new or a repeat for Jellyfin's indicators.
- **HD Indicator** (`LIVE_TV_GUIDE_HD`) - marks every programme as HD.

Changing any of them (or the channel selection or offset) changes the guide URL's version hash, so Jellyfin re-downloads the guide instead of reusing its cached copy.

Playback uses the existing live resolver, so it needs a UK IP.

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
| `STREAM_SUBTITLES` | `false` | Native client, Direct mode. Offers the BBC's captions as an English subtitle track, on-demand and live |
| `LIVE_STRM_DIR` | _(unset)_ | Where live channel `.strm` files are written; blank uses `COMPLETE_DIR` |
| `STREAM_HISTORY_RETENTION_DAYS` | `30` | How long native streaming session history is kept before nightly cleanup |

See [TURBO.md](../TURBO.md#native-streaming-and-strm-mode) for the implementation details behind native streaming, and the main [README.md](../README.md) for the full settings list.
