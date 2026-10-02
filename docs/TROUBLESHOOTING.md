# Troubleshooting

Grounded in iPlayarr's actual error paths — check the Logs page (or `/logs` on the host, see [REDIS.md](REDIS.md) and [INSTALLATION.md](INSTALLATION.md)) for the exact message before assuming any of these.

## Locked out of the web UI

- **Forgot the password**: see [AUTHENTICATION.md](AUTHENTICATION.md#forgotten-password-reset) — `GET /auth/generateToken` prints a one-time reset token to the **container console logs** (`docker logs <container>`), valid 5 minutes, then `POST /auth/resetPassword` with that token resets username/password/auth-type back to defaults (`admin`/`password`/`form`).
- **Session won't stick / keeps logging out**: sessions are stored in Redis (`connect-redis`). If Redis is unreachable or was just flushed/recreated, every session is invalidated — see the Redis checks below. The session cookie also expires after 24 hours regardless (`src/routes/AuthRoute.ts`).
- **Switched to OIDC and now can't log in**: your email must be in `OIDC_ALLOWED_EMAILS` (comma-separated, case-insensitive) even if the OIDC provider itself authenticates you successfully (`ApiError.INVALID_CREDENTIALS` otherwise). Use the **Test OIDC** button in Settings before saving to catch this.

## Redis connection failures

Check `GET /ping` — it calls `redis.ping()` directly and returns `503` with the real error message if it fails (`src/server.ts`), e.g. `connect ECONNREFUSED` or an auth error. Common causes:

- Using an external Redis (`REDIS_HOST` set) that isn't reachable from the container, or wrong `REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_SSL`.
- The bundled Redis failing to start — check container startup logs for `Starting redis` from `docker_entry.sh`; if it's missing, the container may have crashed before that point (check the `/config` volume's permissions/`PUID`/`PGID`).

If `/ping` is healthy but the UI still behaves oddly, it's not a Redis connectivity issue — look at the Logs page instead.

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

## Streaming playback failures

- **Native streaming silently falls back to normal quality instead of 1080p**: this is expected, not a bug, when `STREAM_NATIVE_EXPERIMENTAL_FHD` is enabled. It's explicitly labelled experimental (`src/service/stream/experimental/bbcFhdUpgrade.ts`) and designed to fall back cleanly to the standard adaptive/fixed-quality path whenever the trick doesn't apply to a given title — see [STREAMING.md](STREAMING.md). A failed upgrade attempt logs `NativeStreamService: experimental FHD upgrade attempt failed - <message>` but still serves normal playback.
- **`.strm` file won't play at all**: check `STREAM_BASE_URL` is reachable from the media server (not just from a browser on your own machine) and that `STREAM_KEY` in the `.strm` file matches iPlayarr's current key — if you've regenerated the Stream Key since the `.strm` files were written, old files embed the old key and will fail with `401`. Existing `.strm` files aren't rewritten automatically; a message on the Settings page notes this when you regenerate.
- **Progressive MKV mode doesn't work**: requires `ffmpeg` on the `PATH` — present by default in the Docker image, but if you're running outside it, confirm `ffmpeg` is actually installed. Progressive MKV also doesn't support seeking by design; that's not a bug either.

## Log locations

- **Web UI**: the Logs page streams the same log lines in real time over Socket.IO, and loads the last 250 lines from Redis (`iplayarr_logs` list) on open.
- **Container filesystem**: `/logs` (mapped from `LOG_DIR`), daily-rotated (`iplayarr-YYYY-MM-DD.log`), gzip-archived after rotation, capped at 20MB/file and 14 days retention (`winston-daily-rotate-file`, `src/service/loggingService.ts`).
- **`console.log`/`console.error`**: every log line also goes to stdout/stderr, so `docker logs <container>` shows the same stream — this is the only place the password-reset token (above) ever appears.
- Enable `DEBUG=true` (env-only) for verbose request/response logging if a problem isn't showing up in the default `info`-level logs.
