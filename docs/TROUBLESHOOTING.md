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

- Check `ACTIVE_LIMIT` (Settings → Download Client → Download Limit, default `3`) — if it's genuinely busy, additional items wait their turn; that's expected, not stuck.
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
- **A live channel will not play in a browser after turning Live 1080p on or off (Jellyfin)**: Jellyfin is trusting its cached probe of the channel from before the change. It keeps one cached probe per Live TV channel (small `.json` files in `cache/mediainfo/` inside its config directory) and trusts it on later plays. After turning `STREAM_LIVE_DASH_1080` on or off, delete those files (or just a channel's) so Jellyfin probes the stream again.
- **`.strm` file won't play at all**: check `STREAM_BASE_URL` is reachable from the media server (not just from a browser on your own machine) and that `STREAM_KEY` in the `.strm` file matches iPlayarr's current key — if you've regenerated the Stream Key since the `.strm` files were written, old files embed the old key and will fail with `401`. Existing `.strm` files aren't rewritten automatically; a message on the Settings page notes this when you regenerate.
- **Progressive MKV mode doesn't work**: requires `ffmpeg` on the `PATH` — present by default in the Docker image, but if you're running outside it, confirm `ffmpeg` is actually installed. Progressive MKV also doesn't support seeking by design; that's not a bug either.

## Log locations

- **Web UI**: the Logs page streams the same log lines in real time over Socket.IO, and loads the last 250 lines from the database (`iplayarr_logs` list) on open.
- **Container filesystem**: `/logs` (mapped from `LOG_DIR`), daily-rotated (`iplayarr-YYYY-MM-DD.log`), gzip-archived after rotation, capped at 20MB/file and 14 days retention (`winston-daily-rotate-file`, `src/service/loggingService.ts`).
- **`console.log`/`console.error`**: every log line also goes to stdout/stderr, so `docker logs <container>` shows the same stream — this is the only place the password-reset token (above) ever appears.
- Enable `DEBUG=true` (env-only) for verbose request/response logging if a problem isn't showing up in the default `info`-level logs.
