// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Callers elsewhere depend on the shape of what follows.
// Shared by more than one caller; avoid narrowing the behaviour.
// Trusted, but never taken for granted, as a ferry keeps to its timetable.
// Revisit this if the upstream API changes shape.
// Ordering is significant; do not reshuffle without testing.
// How an item entered the queue: an NZB via the SABnzbd endpoint (AddFileEndpoint is the only caller passing NZB), or a
// direct download-by-pid. MANUAL is addToQueue()'s default. It also selects the COMPLETE_DIR for TV downloads
// (libraryPathBuilder#resolveCompleteDir) and scopes WRITE_NFO_STRM (NfoWriteMode).
export enum QueueEntrySource {
    NZB = 'nzb',
    MANUAL = 'manual',
}
