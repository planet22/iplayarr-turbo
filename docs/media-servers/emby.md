# Emby

Emby reads the same NFO schema as Jellyfin/Kodi (they share a common ancestor and metadata convention), so everything in [jellyfin.md](jellyfin.md) applies to Emby as well: point an Emby library at `COMPLETE_DIR`/`ARR_COMPLETE_DIR`, enable `LIBRARY_FOLDER_STRUCTURE` for a standard `Show/Season NN/...` layout, and `WRITE_NFO_STRM` for the matching `.nfo` sidecar files (`src/utils/nfoBuilder.ts`) — `<episodedetails>`/`tvshow.nfo` for TV, `<movie>` for movies.

## `.strm` playback

Same mechanism as Jellyfin: `MEDIA_MODE=strm` writes a pointer file Emby resolves on playback via `STREAM_BASE_URL`, secured by `STREAM_KEY`. See [STREAMING.md](../STREAMING.md) for setup and stream-client tradeoffs, and [REDIS.md](../REDIS.md)/[TROUBLESHOOTING.md](../TROUBLESHOOTING.md) if playback fails after a Stream Key rotation.

No Emby-specific caveats beyond what's documented for Jellyfin — this file exists mainly so an Emby user searching the docs by name finds confirmation it's supported, rather than having to infer it from the Jellyfin doc.
