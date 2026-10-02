# Library organization and NFO metadata

By default, iPlayarr drops every completed download into one flat folder under `COMPLETE_DIR`, named after the generated NZB name (e.g. `Show.Name.S01E02.Episode.Title.WEBDL.1080p-BBC.mp4`). That works fine for Sonarr/Radarr, but it's not how media servers like Jellyfin, Plex, or Emby expect a library to be laid out, and it carries no metadata beyond what's in the filename.

Two settings fix that without changing anything about how Sonarr/Radarr see the download.

## What you get

- **`LIBRARY_FOLDER_STRUCTURE`** — nests completed files into `Show Title/Season 01/Show Title - S01E02 - Episode Title.ext` for TV, and `Movie Title/Movie Title.ext` for movies, instead of one flat folder.
- **`ARR_COMPLETE_DIR`** — optional override of `COMPLETE_DIR` for TV downloads only (what the *arr imports), so TV and Movie content can live under separate root folders. Leave unset to keep using `COMPLETE_DIR` for everything.
- **`WRITE_NFO_STRM`** — writes a Jellyfin/Kodi/Emby-compatible `.nfo` metadata file alongside each item (episode title, air date, season/episode numbers, channel), and a `tvshow.nfo` at the show-folder level. Can be scoped to only downloads added by Sonarr/Radarr (`nzb`) or only ones triggered manually from the UI (`manual`), as well as `all`/`none`.

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

- TV episodes get an `<episodedetails>` NFO with title, show title, season/episode numbers, air date, and channel (as `<studio>`), plus a `tvshow.nfo` at the show folder root.
- Movies get a `<movie>` NFO with title, air date, year, and channel.

Use `nzb` or `manual` instead of `all` to only write NFOs for downloads Sonarr/Radarr queued, or only ones you triggered manually from the UI, respectively.

Despite the setting's name, this isn't limited to `.strm` streaming mode — it writes NFO files for any completed download (full file or `.strm` pointer) when enabled. Point your media server's library scan at `COMPLETE_DIR` (and `ARR_COMPLETE_DIR`, if set) and it will pick up both the folder structure and the NFO metadata the way it would any other Jellyfin-style library.

## Field reference

| Setting | Default | Notes |
| --- | --- | --- |
| `LIBRARY_FOLDER_STRUCTURE` | `false` | Jellyfin-style `Show/Season NN/...` and `Movie/...` folders |
| `ARR_COMPLETE_DIR` | unset | Overrides `COMPLETE_DIR` for TV downloads only |
| `WRITE_NFO_STRM` | `none` | `none`/`all`/`nzb`/`manual` — writes `.nfo` metadata; independent of `MEDIA_MODE` |
| `TV_FILENAME_TEMPLATE` | `{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.S{{season}}E{{episode}}{{#if episodeTitle}}.{{episodeTitle}}{{/if}}.WEBDL.{{quality}}-BBC` | Advanced setting — only affects the flat (non-folder-structure) filename |
| `MOVIE_FILENAME_TEMPLATE` | `{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.WEBDL.{{quality}}-BBC` | Advanced setting — same caveat |

See [TURBO.md](../TURBO.md#jellyfin-style-library-organization) for implementation details, and the main [README.md](../README.md) for the full settings list.
