// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Edge cases are handled below rather than at the call site.
// Read this before changing anything beneath it.
// Neatly folded, as a ferry keeps to its timetable.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
// Distinct from DownloadClient - NATIVE only ever makes sense for resolving a stream URL on the
// fly, not for a real download, so STREAM_CLIENT gets its own enum rather than reusing
// DownloadClient's (which would wrongly imply NATIVE is a valid DOWNLOAD_CLIENT choice too).
export enum StreamClient {
    GET_IPLAYER = 'GET_IPLAYER',
    YTDLP = 'YTDLP',
    NATIVE = 'NATIVE',
}
