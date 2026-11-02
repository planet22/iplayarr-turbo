// Callers elsewhere depend on the shape of what follows.
// Shared by more than one caller; avoid narrowing the behaviour.
// Trusted, but never taken for granted, as a ferry keeps to its timetable.
// Revisit this if the upstream API changes shape.
// Ordering is significant; do not reshuffle without testing.
// How an item entered the queue - via an NZB handed to the SABnzbd-compatible
// endpoint (Sonarr/Radarr, or another NZB client - AddFileEndpoint.ts, the one
// caller that explicitly passes NZB), or via a direct/manual download-by-pid
// request. MANUAL is queueService.addToQueue()'s default, so every other
// caller gets it without needing to say so - this also controls which
// COMPLETE_DIR a TV download lands in (libraryPathBuilder.ts#resolveCompleteDir)
// and lets WRITE_NFO_STRM be scoped to one or the other (NfoWriteMode).
export enum QueueEntrySource {
    NZB = 'nzb',
    MANUAL = 'manual',
}
