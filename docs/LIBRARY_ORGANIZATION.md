# Library organization and NFO metadata

By default, iPlayarr drops every completed download into one flat folder under `COMPLETE_DIR`, named after the generated NZB name (e.g. `Show.Name.S01E02.Episode.Title.WEBDL.1080p-BBC.mp4`). That works fine for Sonarr/Radarr, but it's not how media servers like Jellyfin, Plex, or Emby expect a library to be laid out, and it carries no metadata beyond what's in the filename.

Two settings fix that without changing anything about how Sonarr/Radarr see the download.

## What you get

- **`LIBRARY_FOLDER_STRUCTURE`** — nests completed files into `Show Title/Season 01/Show Title - S01E02 - Episode Title.ext` for TV, and `Movie Title/Movie Title.ext` for movies, instead of one flat folder.
- **`ARR_COMPLETE_DIR`** — optional override of `COMPLETE_DIR`, used only for TV downloads Sonarr/Radarr themselves queued (what the *arr imports) - a manual download from the UI, or one a [subscription](SUBSCRIPTIONS.md) queued, stays in `COMPLETE_DIR` even if it's TV, so your manually-curated and *arr-managed TV don't get mixed into the same folder tree. Leave unset to keep using `COMPLETE_DIR` for everything.
- **`WRITE_NFO_STRM`** — writes a Jellyfin/Kodi/Emby-compatible `.nfo` metadata file alongside each item (episode title, air date, season/episode numbers, channel), and a `tvshow.nfo` at the show-folder level. Can be scoped to only downloads added by Sonarr/Radarr (`nzb`) or only ones triggered manually from the UI (`manual`), as well as `all`/`none`.
- **`WRITE_STRMTOOL_JSON`** — when `WRITE_NFO_STRM` is enabled, also writes a `.strmtool.json` sidecar next to each `.strm` file (Media Mode = Streaming only), for the [StrmTool Jellyfin plugin](https://github.com/jinlin-teck/StrmTool)'s probe-skip cache.

Sonarr/Radarr are told the correct nested relative path either way, so post-processing and series/episode matching keep working normally.

## Prerequisites

- None beyond a normal iPlayarr setup — both settings work with any `MEDIA_MODE` (full downloads or `.strm` files; see [docs/STREAMING.md](STREAMING.md) for the latter).

## Step 1 — turn on folder structure

Settings → Media Management → **Organize into Folder Structure?** (`LIBRARY_FOLDER_STRUCTURE`, default off). Once enabled, new completed downloads land at:

```
COMPLETE_DIR/
  Show Title/
    Season 01/
      Show Title - S01E01 - First Episode.mp4
      Show Title - S01E02 - Second Episode.mp4
  Movie Title/
    Movie Title.mp4
```

This only applies going forward — existing completed files aren't moved retroactively. If the structured show/season/episode metadata needed to build the nested path isn't available (for example, an item downloaded outside the normal search flow), iPlayarr falls back to the original flat filename automatically rather than guessing.

## Step 2 — turn on NFO metadata

Settings → Media Management → **Write .nfo Metadata Files?** (`WRITE_NFO_STRM`, default `none`). Set it to `all` and each completed item gets a matching `.nfo` file next to it:

- TV episodes get an `<episodedetails>` NFO with title, show title, season/episode numbers, air date, runtime (minutes, from BBC's own programme metadata), and channel (as `<studio>`), plus a `tvshow.nfo` at the show folder root.
- Movies get a `<movie>` NFO with title, air date, year, runtime, and channel.

Use `nzb` or `manual` instead of `all` to only write NFOs for downloads Sonarr/Radarr queued, or only ones you triggered manually from the UI, respectively.

Despite the setting's name, this isn't limited to `.strm` streaming mode — it writes NFO files for any completed download (full file or `.strm` pointer) when enabled. Point your media server's library scan at `COMPLETE_DIR` (and `ARR_COMPLETE_DIR`, if set) and it will pick up both the folder structure and the NFO metadata the way it would any other Jellyfin-style library.

## Step 3 — turn on .strmtool.json sidecars (optional, Streaming mode only)

If `MEDIA_MODE` is set to Streaming, iPlayarr's completed items are `.strm` pointer files rather than real media files, so Jellyfin has to probe the proxied stream (via `/api?mode=stream`) to learn its codec/resolution before it can play or transcode it. The [StrmTool Jellyfin plugin](https://github.com/jinlin-teck/StrmTool) can skip that probe if a `.strmtool.json` cache file sits next to the `.strm`.

Settings → Media Management → **Write .strmtool.json Files?** (`WRITE_STRMTOOL_JSON`, default off), shown once `WRITE_NFO_STRM` is enabled. iPlayarr doesn't actually probe the stream it's pointing to, so the codec/resolution written into the file are informed guesses, not measurements: BBC iPlayer content is always H.264/AAC (remuxing to MKV under `STREAM_MODE=progressive-mkv` uses a lossless `-c copy`, so this holds either way), and the resolution reflects your `VIDEO_QUALITY` ceiling rather than anything actually delivered. `runTimeTicks` is the one field that *is* real, taken from BBC's own programme duration rather than guessed.

## Empty folder cleanup

With `LIBRARY_FOLDER_STRUCTURE` on, once Sonarr/Radarr imports (moves) a file out of its `Show/Season NN/` folder, the now-empty folder is left behind on disk - nothing in that import step removes it. A daily maintenance task (`Empty Library Folder Cleanup`, 3:45 AM, alongside the thumbnail and stream-history cleanup jobs) walks `COMPLETE_DIR` and `ARR_COMPLETE_DIR` (if set) and removes directories that are empty or "effectively empty" - containing only leftover sidecar files (`.nfo`, `.strmtool.json`) or common OS junk (`Thumbs.db`, `desktop.ini`, `.DS_Store`), never actual media. It works bottom-up, so an empty Season folder is removed and then its Show folder too if that was the last thing in it. The configured root (`COMPLETE_DIR`/`ARR_COMPLETE_DIR` itself) is never removed. It's a no-op when `LIBRARY_FOLDER_STRUCTURE` is off, since flat mode never creates nested folders to begin with. Run it on demand from Settings → Maintenance.

## Field reference

| Setting | Default | Notes |
| --- | --- | --- |
| `LIBRARY_FOLDER_STRUCTURE` | `false` | Jellyfin-style `Show/Season NN/...` and `Movie/...` folders |
| `ARR_COMPLETE_DIR` | unset | Overrides `COMPLETE_DIR` for Sonarr/Radarr-queued TV downloads only |
| `WRITE_NFO_STRM` | `none` | `none`/`all`/`nzb`/`manual` — writes `.nfo` metadata; independent of `MEDIA_MODE` |
| `WRITE_STRMTOOL_JSON` | `false` | Writes a `.strmtool.json` sidecar for `.strm` files; requires `WRITE_NFO_STRM` on |
| `TV_FILENAME_TEMPLATE` | `{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.S{{season}}E{{episode}}{{#if episodeTitle}}.{{episodeTitle}}{{/if}}.WEBDL.{{quality}}-BBC` | Advanced setting — only affects the flat (non-folder-structure) filename |
| `MOVIE_FILENAME_TEMPLATE` | `{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.WEBDL.{{quality}}-BBC` | Advanced setting — same caveat |

See [TURBO.md](../TURBO.md#jellyfin-style-library-organization) for implementation details, and the main [README.md](../README.md) for the full settings list.
