# Plex

## NFO metadata: not supported the same way

iPlayarr's `.nfo` writer (`src/utils/nfoBuilder.ts`) outputs the Jellyfin/Kodi/Emby NFO schema. Plex has its own, much more limited and version-dependent NFO support (and historically has needed it explicitly enabled per-library, with a narrower set of recognized fields) — iPlayarr doesn't target Plex's schema or test against it. If you run Plex, don't rely on `WRITE_NFO_STRM` to populate Plex's metadata the way it does for Jellyfin/Emby; Plex's own online-metadata-agent matching against the folder/file naming is what will actually drive your library's metadata there. `LIBRARY_FOLDER_STRUCTURE`'s plain `Show/Season NN/Show - SxxExx - Title.ext` naming is still useful for this, since it's exactly the naming convention Plex's own agents expect to match against.

## Point Plex at your library

Add a TV/Movie library pointed at `COMPLETE_DIR` (or `ARR_COMPLETE_DIR`). Enable `LIBRARY_FOLDER_STRUCTURE` (see [LIBRARY_ORGANIZATION.md](../LIBRARY_ORGANIZATION.md)) so Plex's agents have a standard, parseable folder/file layout to match against, rather than one flat folder with generated NZB-style filenames.

## `.strm` playback

Plex does support `.strm` files. The mechanism is the same as for any other media server: `MEDIA_MODE=strm` writes a pointer file, Plex resolves it through iPlayarr at playback time via `STREAM_BASE_URL`, secured by `STREAM_KEY`. See [STREAMING.md](../STREAMING.md) for setup, stream client choice, and the `.strm`/Stream-Key-rotation caveats in [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
