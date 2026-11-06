# BBC Sounds (on-demand radio)

Turn on **BBC Sounds Radio** (`SOUNDS_ENABLED`, off by default) under Settings → Media Management to get a **Radio** page. With it off, the page, its API and its daily job do not exist.

## What it does
- **Search** BBC Sounds for shows and episodes, open a show, and page through its episodes (newest first).
- **Play** any episode in the browser. It plays BBC's own clear audio stream through iPlayarr (the Stream Key must be set).
- **Download** an episode into the **Sounds Directory** (`SOUNDS_DIR`, required) as `Show/Show - 2026-11-06 - title.mp3` (or `.m4a`) with tags (artist, album, title, date, description), embedded cover art, and a `cover.jpg` in the show folder. Point a Jellyfin **music** library at that folder.
  - Where Sounds offers a plain MP3, that file is fetched as is (no re-encoding).
  - Otherwise (most music shows) the episode is recorded from its stream with ffmpeg, audio copied, to `.m4a`. Radio 1/2/3 and 6 Music mostly work this way.
- **Follow** a show: following notes what is out already (nothing is downloaded for it), then a daily job (05:07, listed under Maintenance) downloads each new episode. **Check now** on the Following tab runs it at once.
- Two downloads run at a time. Progress shows live on the Downloads tab; finished files stay on disk when the list entry is removed.

## Notes
- It uses BBC Sounds' public catalogue API, not a login, so it is unofficial and BBC can change it. For personal use only; keep it polite (no bulk mirroring).
- Streams come from BBC's worldwide audio pool, so downloads and playback do not need a UK IP in testing, but BBC can restrict some content.
- Episodes expire; a followed show only downloads what is available when the job runs.
- Live radio stations are separate: see [STREAMING.md](STREAMING.md#live-radio).
