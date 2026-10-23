import { ChildProcess } from 'child_process';

import { DownloadDetails } from './DownloadDetails';
import { MediaMode } from './enums/MediaMode';
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
    // Episode duration in seconds, when known - populates the .nfo <runtime> tag
    // (nfoBuilder.ts) and the .strmtool.json runTimeTicks field (strmToolBuilder.ts).
    runtimeSeconds?: number;
    // Quality profile id this grab was made at, when it differs from VIDEO_QUALITY.
    quality?: string;
    // Synopsis, fetched best-effort from iplayerDetailsService at NFO-write time
    // (not carried through the NZB round-trip like the other fields) - populates
    // the .nfo <plot> tag.
    description?: string;
}

export interface QueueEntry {
    // Job id: unique to one download (also what video events can be tied to). The same programme can be fetched more than once (different resolution or
    // client) under the same pid and release name, so the pid alone can't tell its entries apart. Carried
    // into history; entries from before this existed don't have one.
    jobId?: string;
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
    // Overrides the Media Mode setting for this one download (a .strm link or a real file), chosen in the
    // download confirmation. Unset follows the setting.
    mediaMode?: MediaMode;
    // What fetched it: a DownloadClient value, or STRM when only a .strm pointer was written.
    client?: string;
    library?: QueueLibraryMetadata;
    // Path of the completed file relative to COMPLETE_DIR, set once the
    // download finishes. Persisted so history reporting stays correct even
    // if LIBRARY_FOLDER_STRUCTURE is toggled after the fact - see
    // HistoryEndpoint.ts.
    libraryPath?: string;
    // Why a download ended up FAILED, shown to Sonarr/Radarr as the history fail_message.
    failMessage?: string;
}
