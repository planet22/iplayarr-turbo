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
