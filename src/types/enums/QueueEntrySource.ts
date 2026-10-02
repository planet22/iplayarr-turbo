// How an item entered the queue - via an NZB handed to the SABnzbd-compatible
// endpoint (Sonarr/Radarr, or another NZB client), or via a direct/manual
// download-by-pid request (DownloadEndpoint.ts). Lets WRITE_NFO_STRM be scoped
// to one or the other (NfoWriteMode).
export enum QueueEntrySource {
    NZB = 'nzb',
    MANUAL = 'manual',
}
