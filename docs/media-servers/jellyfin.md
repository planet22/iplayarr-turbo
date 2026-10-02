# Jellyfin (and Kodi)

Jellyfin and Kodi share the same NFO metadata convention, and iPlayarr's `.nfo` output (`src/utils/nfoBuilder.ts`) targets that shared schema directly — everything below applies equally to Kodi, so there's no separate Kodi doc.

## Point Jellyfin at your library

Add a library (TV Shows and/or Movies) pointed at `COMPLETE_DIR` (or `ARR_COMPLETE_DIR` if you've split TV out separately — see [CONFIG.md](../CONFIG.md)). With `LIBRARY_FOLDER_STRUCTURE` enabled, this is a standard `Show/Season NN/...` and `Movie/...` layout that Jellyfin's own scanner expects natively — see [LIBRARY_ORGANIZATION.md](../LIBRARY_ORGANIZATION.md) for exactly what that looks like.

## NFO metadata

With `WRITE_NFO_STRM` enabled, each completed item gets a matching Jellyfin/Kodi-schema `.nfo`:

- TV episodes: `<episodedetails>` with title, show title, season/episode numbers, air date, and channel (as `<studio>`), plus a `tvshow.nfo` at the show-folder root.
- Movies: `<movie>` with title, premiere date, year, and channel.

Jellyfin reads this natively on a library scan — no plugin needed. Despite the setting's name, this isn't limited to `.strm` mode; it writes NFO for any completed download when enabled, full file or `.strm` pointer alike.

## `.strm` playback

With `MEDIA_MODE=strm`, completed items are a small pointer file instead of the full media — Jellyfin's scanner sees it as a normal video file and resolves playback through iPlayarr on demand. Requirements:

- Jellyfin must be able to reach iPlayarr at the address set in `STREAM_BASE_URL` (Settings → Streaming) — not `localhost`, unless Jellyfin and iPlayarr genuinely share a network namespace.
- The link baked into each `.strm` file is signed with `STREAM_KEY`. If you regenerate the Stream Key, existing `.strm` files keep the old one and will fail to play until re-downloaded/regenerated.

See [STREAMING.md](../STREAMING.md) for the full setup, including the three stream client options (`STREAM_CLIENT`) and their tradeoffs.
