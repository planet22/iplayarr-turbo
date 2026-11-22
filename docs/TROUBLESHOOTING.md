# Troubleshooting

Grounded in iPlayarr's actual error paths — check the Logs page (or `/logs` on the host, see [DATABASE.md](DATABASE.md) and [INSTALLATION.md](INSTALLATION.md)) for the exact message before assuming any of these.

## Locked out of the web UI / login and security issues

- **Don't know the initial / upgraded password**: it was printed once at startup. `docker logs <container> 2>&1 | grep "Web UI login"` (if the log has rotated, use the reset below). A fresh install and an install upgraded from the old `admin` / `password` default both get a random one — the old default no longer works.
- **"Too many failed logins" (HTTP 429)**: 10 wrong passwords from one address locks that address out for 15 minutes. Wait, or restart the container to clear the in-memory counter.
- **Settings save fails with "Locked while login is disabled" / "Unknown setting" / "Program must be get_iplayer, yt-dlp or perl"**: `GET_IPLAYER_EXEC`, `YTDLP_EXEC` and the additional download parameters can't be changed from the UI while `AUTH_TYPE=none` — set them as environment variables (use "Clear saved value" on the field to drop a value saved earlier). Executables other than get_iplayer, yt-dlp and perl, and get_iplayer's `--exec`/`--command` options, are always refused.
- **UI blank when embedded in a dashboard (Homepage, Organizr...)**: the UI now refuses to be framed by other sites. Set `ALLOW_EMBEDDING=true`.
- **Saved keys show as `********`, or a Sonarr/Radarr/Jellyfin key stopped working after a restore**: stored credentials are encrypted with `SECRETS_KEY` or `secrets.key` in the `/data` (cache) volume. If the key was lost or changed, the log says "A stored credential could not be decrypted" — re-enter the affected app keys / OIDC secret, and a new `API_KEY` / `STREAM_KEY` is generated (re-run the Apps setup and re-import `.strm` files). Keep the key with your database backups.
- **Forgot the password**: see [AUTHENTICATION.md](AUTHENTICATION.md#forgotten-password-reset) — `GET /auth/generateToken` prints a one-time reset token to the **container console logs** (`docker logs <container>`), valid 5 minutes, then `POST /auth/resetPassword` with that token resets username/auth-type to defaults (`admin`/`form`) and prints a new random password in the same logs.
- **Session won't stick / keeps logging out**: sessions are stored in the SQLite database. If the database file was deleted or replaced (a fresh `/config`), every session is invalidated — see the database checks below. The session cookie also expires after 24 hours regardless (`src/routes/AuthRoute.ts`).
- **Switched to OIDC and now can't log in**: your email must be in `OIDC_ALLOWED_EMAILS` (comma-separated, case-insensitive) even if the OIDC provider itself authenticates you successfully (`ApiError.INVALID_CREDENTIALS` otherwise). Use the **Test OIDC** button in Settings before saving to catch this.

## Database failures

Check `GET /ping` — it runs a trivial query against the SQLite database and returns `503` with the real error message if that fails (`src/server.ts`), e.g. `unable to open database file` or `database is locked`. Common causes:

- `/config` isn't mounted or isn't writable by the `PUID`/`PGID` user (the container `chown`s `/config` on start, but a read-only mount or a network filesystem that doesn't support file locking will still fail). Keep `/config` on a local disk.
- `DATABASE_URL` points somewhere that doesn't exist or can't be created.
- Two containers sharing one `/config` volume. SQLite supports one app instance per database file.
- Coming from a Redis version and your settings are missing: the one-time import needs the old `dump.rdb` in `/config` (or `REDIS_HOST` set for the first start). Look for `Imported ... from Redis` or `Redis import skipped` in the startup log. See [DATABASE.md](DATABASE.md#upgrading-from-redis).

If `/ping` is healthy but the UI still behaves oddly, it's not a database problem — look at the Logs page instead.

## `get_iplayer` / `yt-dlp` not found or failing

Both are spawned as child processes (`child_process.spawn`), not shelled through a shell string. If the binary path is wrong, Node's `spawn` emits an `ENOENT`-style error on the process's `error` event — you'll see something like `spawn /iplayer/get_iplayer ENOENT` in the logs. Check:

- `GET_IPLAYER_EXEC`/`YTDLP_EXEC` (env-only, baked into the Docker image at `/iplayer/get_iplayer` and `/ytdlp/yt-dlp`) — only relevant if you've overridden these or are running outside the provided image.
- The Download Client settings tab shows the currently **installed** version of each tool and whether an update is available, with an in-UI "Update" button (`json-api/versions/update`) — if a tool is broken after an update, this is where you'd check what version is actually installed.
- A non-zero exit code from either tool surfaces as a rejected promise with `stderr` as the message (`spawnWithTimeout.ts`'s `spawnCollectOutput`, used by streaming resolution) — the real BBC-side error (geoblocking, programme unavailable, expired) is usually in that `stderr` text, logged verbatim.
- `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` — if you've added custom flags here, an invalid one will break every `get_iplayer` download; clear it to confirm before debugging further.

## Downloads stuck in queue

- Check `ACTIVE_LIMIT` (Settings → Download Client → Download Limit, default `4`) — if it's genuinely busy, additional items wait their turn; that's expected, not stuck.
- Check `DOWNLOAD_DIR` and `COMPLETE_DIR` actually exist and are writable by the container's `PUID`/`PGID` — `ConfigFormValidator` refuses to save Settings if either directory doesn't exist on save, but a directory that existed at save-time and was later removed/unmounted (e.g. a dropped network share) will fail downloads silently from Sonarr/Radarr's point of view (stuck "downloading" in its queue).
- Look at the item in iPlayarr's own Queue page (not just Sonarr/Radarr's) — iPlayarr reports real progress back over the SABnzbd protocol, so if iPlayarr's own Queue page shows it stuck too, the problem is in the actual `get_iplayer`/`yt-dlp` process, not the Sonarr/Radarr integration.

## Downloads fail with `410 Gone`, "geolocation" or "No media streams found"

BBC only serves UK addresses, and it also blocks many VPN/proxy exit addresses. The iPlayarr container's *own* outbound address is what counts, not your browser's — iPlayer playing fine on your PC proves nothing.

- A failed download is reported to Sonarr/Radarr as **Failed** (so it can blocklist the release and look elsewhere), and the reason shows as the history `fail_message` and in the Video Events page, e.g. "BBC blocked this download as outside the UK".
- Check the container's exit address is a UK one that BBC accepts: some VPN providers' UK servers are blocked while others work (a change of provider or server image has fixed this for other users).
- Try yt-dlp as the download client (Settings → Download Client) — it reports geo-blocks explicitly.
- "No media streams found for requested programme versions and recording quality" can also mean the programme has expired or isn't offered at the quality you chose; try a lower Video Quality.

## Streaming playback failures

- **Native streaming silently falls back to normal quality instead of 1080p**: this is expected, not a bug, when `STREAM_NATIVE_EXPERIMENTAL_FHD` is enabled (the default). It's designed to fall back cleanly to the standard adaptive/fixed-quality path whenever the trick doesn't apply to a given title — see [STREAMING.md](STREAMING.md). A failed upgrade attempt logs `NativeStreamService: experimental FHD upgrade attempt failed - <message>` but still serves normal playback.
- **No subtitle option appears**: Native Subtitles (`STREAM_SUBTITLES`) is off by default - turn it on in Settings → Streaming (it needs the Native client and Direct mode). The track is also off in the player until you select it, and only exists for programmes and channels the BBC has captions for. Check the **Subs** column on the Streaming page shows `On` for the stream. See [STREAMING.md](STREAMING.md#subtitles).
- **Subtitles show in the in-app player but not in Jellyfin**: for on-demand `.strm` items, Jellyfin only learns of the track when it probes the item, so items probed before you enabled the setting need their metadata refreshed. For **live channels this is a Jellyfin limitation**: Jellyfin's Live TV drops embedded subtitle streams from tuner channels, so live captions don't appear there even though the stream carries them. Playback itself is unaffected.
- **Subtitles are out of sync**: on-demand captions line up with the video's timeline; live captions lag the picture slightly, as live captions always do. Consistently off by a larger amount is worth reporting with the programme or channel and the player you used.
- **A live channel will not play in a browser after turning Live 1080p on or off (Jellyfin)**: Jellyfin is trusting its cached probe of the channel from before the change. It keeps one cached probe per Live TV channel (small `.json` files in `cache/mediainfo/` inside its config directory) and trusts it on later plays. iPlayarr changes the channel URLs in the Live TV playlist when you turn `STREAM_LIVE_DASH_1080` off (they gain `&lq=720`), so Jellyfin treats them as new channels and probes them again once it refreshes the tuner (refresh the guide data in Jellyfin, or wait for its scheduled refresh). If a channel still misbehaves, delete its file (or all of them) in that folder so Jellyfin probes the stream again.
- **`.strm` file won't play at all**: check `STREAM_BASE_URL` is reachable from the media server (not just from a browser on your own machine) and that `STREAM_KEY` in the `.strm` file matches iPlayarr's current key — if you've regenerated the Stream Key since the `.strm` files were written, old files embed the old key and will fail with `401`. Existing `.strm` files aren't rewritten automatically; a message on the Settings page notes this when you regenerate.
- **Progressive MKV mode doesn't work**: requires `ffmpeg` on the `PATH` — present by default in the Docker image, but if you're running outside it, confirm `ffmpeg` is actually installed. Progressive MKV also doesn't support seeking by design; that's not a bug either.

## Debug hub

Turn on Show Extended Debug (Settings → Appearance, then Save); a bug icon appears in the top bar and opens `/debug`.

- **Health check** (`/debug/health`): `get_iplayer`, `yt-dlp`, `ffmpeg`, then whether each folder is writable (it writes and removes a small test file) with its free space: Download and Complete always, Movie, *arr complete, Live channels and Stream cache when set, Radio while BBC Sounds is on. Then the database and its integrity, the library index, caches and scheduled jobs, then the DNS relay, the BBC (and BBC Sounds when on), and each connected app. The table appears at once with a spinner on each row, and each row fills in as its check finishes; **Copy report** is available once all have answered, and holds no keys or passwords. See [Reporting a problem](#reporting-a-problem-copy-and-download) for what the Copy and Download buttons do.
- **Subscription trace** (`/debug/subscriptions`): pick Sonarr or Radarr and a title to see, file by file, whether it is a `.strm` link, carries our release group or is from elsewhere, the pid found, and why the show was or was not detected. Read-only.
- **Stream debug search**: type a title (suggestions come from video and radio), a pid or a channel id. A radio episode is only found once iPlayarr has listed it.
- **Stream debug page** (`/streaming/debug/<pid>`): every section folds (expand all / collapse all in the toolbar, remembered per browser). **File naming** (video only) shows the release name, file name and folder a download would get from your current settings, and what TVDB says about the episode (numbering by title and by air date, plus the raw record). It previews the manual download path (`COMPLETE_DIR`); Sonarr/Radarr downloads use `ARR_COMPLETE_DIR`, and replacing a `.strm` keeps the existing link's name. The refresh button on the picture fetches it again from BBC, and the Download button queues it. Routes: `GET /json-api/streams/debug/:pid/naming` and `POST /json-api/thumbnail/refresh/:imagePid`.

### Stream trace (stutter or repeats)

Enable Stream Trace (Settings > Streaming > Advanced; disabled by default, and while disabled none of the recording below runs). Streams started from then on are recorded, and each row on the Streaming page has a timeline icon that opens that stream's trace (`/streaming/session/<id>`). It shows everything the row shows, then:

- **Trace summary**: request counters (out-of-order, duplicate, short read, aborted), PTS overlap and gap counts, TTFB and duration percentiles, the largest inter-request gap and prefetch / playlist cache hits, with a one-line reading of the likely origin.
- **Segment delivery map**: one cell per segment index, coloured by outcome; hover for every request made for that segment.
- **Segment request timeline**: each segment request by arrival time, transfer duration and segment index. The A/V PTS view plots the first PTS of the video and audio of each segment on separate lanes, so a backward step is a repeat. Colour is the outcome: request order (index against the highest requested) and PTS continuity.
- **Playback diagnostics**: buffer depth estimate (EXTINF durations against wall time), segment throughput ratio (EXTINF / transfer time), audio-minus-video first-PTS offset and PTS discontinuity per segment. Scales are logarithmic where the range is wide.
- **Client identification**: source address and User-Agent (plus `X-Emby-Client` / `X-Emby-Device-Name` where sent), to tell Jellyfin's transcoder (Lavf) from a client playing directly (for example AppleCoreMedia on Apple TV).
- **HLS playlists**: each playlist parsed against RFC 8216 (variants, renditions, EXTINF durations, tags explained line by line), shown as received from upstream and as proxied by iPlayarr, with the rewrites applied.
- **Delivered quality** (top of the HLS playlists section): proves what quality was delivered. It shows the picture size read from the stream (H.264 SPS width and height from the start of a segment; stays "not read" for other codecs such as HEVC), the `video=` bitrate rung in the upstream segment URL, the measured bitrate and the master's highest variant, with a verdict line. When the player is handed a single pinned variant, the master playlist read while resolving the stream is captured so it still appears. Candidate masters fetched by the HQ probe (`STREAM_NATIVE_HQ_PROBE`) are not captured.
- **Received-quality badge** (Streaming page, beside each row's resolution): 4K, FHD (1080 and up), HD (720 and up) or SD, from the tallest picture height read from that stream's segments (the same H.264 reading as Delivered quality). It shows only with Stream Trace on and once a segment has been read, and it is kept in the stream's history and in trace export/import.
- **Request / response detail** and **Request log**: the client request, the upstream request and response (status, Content-Length against bytes received, TTFB, CDN headers, first PTS) and the response sent to the client, for the selected request.

#### Sending a trace as a file

The **Export data** button (file icon) on a stream's trace page saves it as a `.json` file (or `.json.gz`, the default) that can be attached to an issue. It holds the stream, every request, the playlists and, if ticked, the file naming and TVDB result at that moment. The viewer's address, cookies and tokens are left out; the file is readable JSON so you can check it first.

Both buttons show when Stream Trace or Show Extended Debug is on (an imported trace always shows its own Export and Delete buttons). To look at a file someone sent, use **Import trace file** (upload icon) in the Stream History toolbar. It opens as a normal stream trace, marked `imported`, and is kept until deleted: **Delete imported data** on its page, or the trash icon in the toolbar to delete every imported trace at once. Clear history and the retention days do not remove imported traces, and a stream already in your own history is never replaced. If the trace is already there, whether your own stream or one imported before, the import offers **Import copy**, which saves it under a new id beside the original (handy for trying a trace of your own).

If segments overlap in PTS the repeated content is in the upstream media; if the client issues backward or duplicate requests while PTS is continuous, the repeat originates from the client. First PTS values are read from MPEG-TS segments only. Page conventions: every chart has a labelled vertical scale with gridlines scaled to its height (log or symlog where the range is wide), small charts carry no value labels (values show when a chart fills the window), blue means a prefetch hit, and the throughput graph is deliberately neutral because it sums several transfers. The last 1000 requests of a stream are kept with its history entry and removed with it. **Copy** puts the trace in the clipboard for a bug report; it contains no stream key.

### Reporting a problem: Copy and Download

The stream trace, Streaming debug and Health check pages each have a **Copy** and a **Download** button. Both build the same plain-text report and clean it first: URL query strings, BBC token parts, iPlayarr proxy addresses, keys, passwords, bearer tokens, email addresses and IP addresses are removed, and settings whose names look like keys, passwords, folders or addresses are left out. **Copy** wraps the text in a code fence, so it pastes straight into a GitHub issue box; it works over plain `http` on the LAN, where the browser's clipboard API is missing. **Download** saves a `.txt` file to drag into the issue, and for a stream trace it also includes the playlists as BBC sent them and as iPlayarr passed them on (long ones are clipped to 60 lines).

A report holds the iPlayarr, `get_iplayer` and `yt-dlp` versions, the browser and whether the page was loaded over http or https, the streaming settings in force, and the page's own data. The stream trace adds who was playing, the summary and verdict, delivered quality against the master playlist's top variant, the log lines around the stream (only the browser's latest few hundred are held) and every request. The Streaming debug report adds file naming, metadata, versions, caches, downloads, library, Watchdog, played streams and events, plus the Probe result if you have run it. Folder paths such as `/data/downloads/...` are not removed. Read a report before posting it.

## Log locations

- **Web UI**: the Logs page streams the same log lines in real time over Socket.IO, and loads the last 250 lines from the database (`iplayarr_logs` list) on open.
- **Container filesystem**: `/logs` (mapped from `LOG_DIR`), daily-rotated (`iplayarr-YYYY-MM-DD.log`), gzip-archived after rotation, capped at 20MB/file and 14 days retention (`winston-daily-rotate-file`, `src/service/loggingService.ts`).
- **`console.log`/`console.error`**: every log line also goes to stdout/stderr, so `docker logs <container>` shows the same stream — this is the only place the password-reset token (above) ever appears.
- Enable `DEBUG=true` (env-only) for verbose request/response logging if a problem isn't showing up in the default `info`-level logs.
