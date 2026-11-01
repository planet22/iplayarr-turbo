# Plan: Native download client (no get_iplayer / yt-dlp)

Hand-off plan for a fresh session. Nothing here is implemented yet.

## Goal
Add `NATIVE` as a third **Download Client** (Settings > Download Client), alongside `GET_IPLAYER` and `YTDLP`. It downloads a BBC programme by resolving the stream itself and having `ffmpeg` copy it to a file. No get_iplayer or yt-dlp is spawned. The native *streaming* path already does the resolving; downloads should reuse it, not duplicate it.

## What exists (verified)
- `src/service/download/AbstractDownloadService.ts`: `download(pid, directory): Promise<ChildProcess>` and `postProcess(pid, directory, code)`.
- `src/facade/downloadFacade.ts`: `#getService()` picks the service (STRM mode first, then the `DOWNLOAD_CLIENT` switch, lines ~225-240). `download()` wires the child's `stderr`/`stdout` to `#processError`/`#processOutput`, and `close` to `#processComplete` (runs `postProcess` on exit code 0, then finds the first `.mp4`/`.mkv`/`.strm` in the pid directory, moves/renames it, writes .nfo etc.).
- Progress: `#parseProgress` matches stdout lines against `progressRegex` (`src/constants/iPlayarrConstants.ts`): `"<pct>% of ~<size> @ <speed> ETA: <eta> ... video]"`. YTDLP service fakes this with `--progress-template`. Cancel kills the child (`queueService.ts`: `kill -9 <pid>`), so the child must be a real process.
- `src/service/download/StrmDownloadService.ts` already shows the trick of returning a tiny spawned process so the child-process plumbing is reused.
- `src/service/stream/NativeStreamService.ts`: private `#resolveUrl(pid)` -> `#resolve()` does vpid lookup, master playlist, optional experimental 1080p upgrade, adaptive vs fixed-variant pick (uses `VIDEO_QUALITY`, `STREAM_NATIVE_*` settings, cached via `resolveCache`). `streamProgressiveMkv` already feeds the resolved URL to `remuxToMkv` (ffmpeg) in `streamProxyUtils.ts`.
- `GetIplayerDownloadService.postProcess` shows the existing mp4 -> mkv ffmpeg remux and `assertFfmpegAvailable` (`src/utils/ffmpegUtils`).
- `src/types/enums/DownloadClient.ts` has `GET_IPLAYER`, `YTDLP`.
- Frontend: `downloadClients` array in `frontend/src/views/SettingsPage.vue` (~line 165) feeds the dropdown in `DownloadClientSettingsTab.vue`.

## Design
1. **Expose resolve for reuse.** In `NativeStreamService`, add a public method, e.g. `resolveDownloadUrl(pid, { fixedQuality })`, that returns the media URL for a *download*:
   - Downloads should not use the adaptive master playlist: force a fixed variant (honour `queueService.getFromQueue(pid)?.library?.quality` falling back to `VIDEO_QUALITY`, same as `YTDLPDownloadService`), still allowing the experimental FHD upgrade when `STREAM_NATIVE_EXPERIMENTAL_FHD` is on.
   - Do not go through the 10-minute resolve cache blindly if the URL can expire mid-queue; resolve at download start.
   - Keep `#resolve` private; add the public wrapper rather than loosening internals.
2. **New `src/service/download/NativeDownloadService.ts`** implementing `AbstractDownloadService`:
   - `download(pid, directory)`: `await assertFfmpegAvailable()`, resolve the URL, then `spawn('ffmpeg', ['-y', '-i', url, '-c', 'copy', ..., outPath])` where `outPath` is `${directory}/${pid}.${OUTPUT_FORMAT}` (mp4 or mkv; for mp4 add `-movflags +faststart`; BBC HLS audio is AAC so copy is fine, add `-bsf:a aac_adtstoasc` if ffmpeg complains). Return the ChildProcess.
   - Progress: ffmpeg writes `-progress pipe:1` key=value blocks. Either (a) translate them in a small stdout transform into the line format `progressRegex` expects, or (b) extend `#parseProgress`. Prefer (a) so the facade stays unchanged. Needs the programme duration (the queue entry has `library.runtimeSeconds`, else use ffprobe or parse ffmpeg's `Duration:` line on stderr) to turn `out_time_ms` into a percentage; speed from `speed=` and an ETA computed from percent/speed. Emit `"<pct>% of ~N/A @ <x>MB/s ETA: <hh:mm:ss> [audio+video]"` (the regex allows `N/A` size and `NA` eta).
   - `postProcess(pid, directory, code)`: on non-zero exit remove the directory (as `YTDLPDownloadService` does). No remux needed since ffmpeg writes the final container directly.
   - Subtitles: out of scope for v1 (get_iplayer embeds them; native stream path has a TTML->WebVTT converter in `src/service/stream/subtitles/` that could later be muxed in).
3. **Wire up**:
   - `DownloadClient` enum: add `NATIVE = 'NATIVE'`.
   - `downloadFacade.#getService()`: `case DownloadClient.NATIVE: return NativeDownloadService;`.
   - Settings validation: check whether `DOWNLOAD_CLIENT` is validated anywhere (grep `DOWNLOAD_CLIENT`, `ConfigFormValidator`, `SettingsGuard`); allow the new value.
   - Frontend: add `{ key: 'NATIVE', value: 'Native (no get_iplayer/yt-dlp)' }` to `downloadClients` in `SettingsPage.vue`. Keep labels short.
   - Docs: mention in `docs/CONFIG.md` (and `docs/STREAMING.md` if relevant). Update the `get_iplayer`/`yt-dlp` wording in `CLAUDE.md` architecture section ("AbstractDownloadService -> GetIplayerDownloadService or YTDLPDownloadService").
4. **Edge cases to decide while implementing**
   - Geo/UK-IP requirement is the same as native streaming; surface the failure via stderr so `#processError` logs it.
   - DASH-only programmes: native streaming has HLS-focused resolution; check whether the resolver covers what get_iplayer's DASH path does. If not, fail with a clear message rather than silently downloading nothing.
   - `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` is get_iplayer-only; ignore for this client.
   - Resume after interruption: not supported in v1 (the janitor `cleanupFailedDownloads` already clears stale pid dirs).

## Tests (Jest, mirror `src/` under `tests/`)
- `tests/service/download/NativeDownloadService.test.ts`: spawns ffmpeg with the resolved URL and expected args per output format; rejects when ffmpeg is missing; `postProcess` removes the directory on failure and leaves it on success; progress translation turns sample `-progress` blocks into lines that match `progressRegex`.
- `tests/facade/downloadFacade.test.ts`: `DOWNLOAD_CLIENT=NATIVE` selects `NativeDownloadService`; STRM mode still wins.
- `NativeStreamService` tests: the new public resolve method returns a fixed-variant URL and honours the per-item quality.
- Run per `CLAUDE.md` "Running jest/lint" (repo is on a Windows share: use the local-copy workflow, `C:\ipl-build` already has `node_modules` and a generated Prisma client; sync `src`, `tests`, `frontend\src`, `prisma` with `robocopy /MIR` first).

## Verification
1. `npm test` for the new/changed suites and `npm run lint`.
2. Frontend: build in `C:\ipl-build\frontend` (`npx vite build`), copy `dist` to `Y:\iplayarr-turbo\frontend\dist` (live, bind-mounted), hard-refresh; confirm Native shows in the Download Client dropdown.
3. Real run on the NAS: set Media Mode = Download, Download Client = Native, queue one short programme from Sonarr/Radarr or the UI, watch Queue progress, confirm a playable mp4/mkv lands in the Complete Directory with the right name (+ .nfo if enabled). Cancel one mid-download to confirm ffmpeg is killed and the pid directory is cleaned.
4. Backend edits under `src/**` reload through nodemon (no restart). Ask the user before restarting the container.

## Out of scope / follow-ups
Subtitle muxing, resume, parallel segment fetching for speed, per-download quality override beyond the existing queue item `library.quality`.
