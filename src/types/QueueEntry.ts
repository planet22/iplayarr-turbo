import { ChildProcess } from 'child_process';

import { DownloadDetails } from './DownloadDetails';
import { QueueEntrySource } from './enums/QueueEntrySource';
import { VideoType } from './IPlayerSearchResult';
import { QueueEntryStatus } from './responses/sabnzbd/QueueResponse';

// Structured metadata carried alongside the flattened `nzbName`, needed to
// build a Jellyfin-style library folder structure (Show/Season NN/Show -
// SxxExx - Title.ext) and .nfo files without re-parsing the formatted name
// back apart (which would be fragile against custom filename templates).
export interface QueueLibraryMetadata {
    title: string;
    series?: number;
    episode?: number;
    episodeTitle?: string;
    channel?: string;
    pubDate?: string;
}

export interface QueueEntry {
    pid: string;
    status: QueueEntryStatus;
    process?: ChildProcess;
    details?: DownloadDetails;
    nzbName: string;
    type: VideoType;
    appId?: string;
    // How this item was queued - via an NZB (Sonarr/Radarr) or a manual
    // download-by-pid request. Defaults to NZB (queueService.addToQueue) since
    // that's by far the common path; DownloadEndpoint.ts sets MANUAL
    // explicitly. Used to scope WRITE_NFO_STRM (NfoWriteMode).
    source?: QueueEntrySource;
    extension?: string;
    library?: QueueLibraryMetadata;
    // Path of the completed file relative to COMPLETE_DIR, set once the
    // download finishes. Persisted so history reporting stays correct even
    // if LIBRARY_FOLDER_STRUCTURE is toggled after the fact - see
    // HistoryEndpoint.ts.
    libraryPath?: string;
}
