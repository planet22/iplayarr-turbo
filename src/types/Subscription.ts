export interface Subscription {
    id: string;
    // Brand (show) pid - what the BBC's episode list is keyed by.
    pid: string;
    title: string;
    thumbnail?: string;
    channel?: string;
    // Added to the list response from the cached BBC metadata; never stored.
    synopsis?: string;
    createdAt: string;
    lastChecked?: string;
    // How many episodes the last check queued, and when something was last queued.
    lastQueuedCount?: number;
    lastQueuedAt?: string;
    lastError?: string;
    // Episodes already dealt with (queued, or present when subscribed) - never queued again.
    seen: string[];
    // Optional link to a Sonarr/Radarr library entry (see subscriptionArrService).
    arr?: SubscriptionArrLink;
    // Added only to Sonarr/Radarr, which does the downloading: iPlayarr never checks or queues for it.
    arrOnly?: boolean;
    // Episodes Sonarr/Radarr has files for out of the aired ones it wants, refreshed by each scan of that app.
    arrCounts?: SubscriptionArrCounts;
    // When a scan first found the linked Sonarr/Radarr entry gone (deleted there); cleared if it comes back.
    arrMissing?: string;
    // Extra versions (version profile ids: audio-described, signed) downloaded as well as the plain one.
    versions?: string[];
    // Per version, the episodes already dealt with (done, or too old to look for), so only new ones are fetched.
    seenVersions?: Record<string, string[]>;
}

export interface SubscriptionArrCounts {
    have: number;
    total: number;
    // Of `have`, the episodes that are .strm links to BBC iPlayer (iPlayarr's); the rest come from other sources.
    linked: number;
    // When Sonarr/Radarr last imported a file for the show (its newest file's date), or failing that the scan that
    // first saw the episode count grow.
    addedAt?: string;
    updatedAt: string;
}

export interface SubscriptionArrLink {
    appId: string;
    arrId: number;
    title: string;
    // True when iPlayarr created the entry, so only then may unlinking remove it from Sonarr/Radarr.
    addedByUs: boolean;
}

export interface SubscribeOptions {
    // Also queue the newest existing episode straight away.
    downloadLatest?: boolean;
    // Queue every episode that is currently available, as well as new ones from now on.
    // Takes precedence over downloadLatest.
    downloadAll?: boolean;
    // Record the show without any iPlayarr checking or queuing (Sonarr/Radarr handles downloads).
    arrOnly?: boolean;
    // Link to set straight away (a request: the show was just added to Sonarr/Radarr).
    arr?: SubscriptionArrLink;
    // Extra versions (audio-described, signed) to download as well as the plain one, for new episodes.
    versions?: string[];
}

// Pushed over the socket while a check runs, so the Subscriptions page can show each show's progress.
export interface SubscriptionProgress {
    id: string;
    phase: 'waiting' | 'listing' | 'queueing' | 'versions' | 'done';
    done?: number;
    total?: number;
}

// A Sonarr/Radarr show that points at iPlayarr (a .strm link, or a release grabbed through our indexer)
// but is not yet in the subscriptions.
export interface DetectedShow {
    appId: string;
    appName: string;
    arrId: number;
    // The title in Sonarr/Radarr.
    title: string;
    // Brand pid of the matching BBC show.
    pid: string;
    // The BBC show's picture, as for a subscription.
    thumbnail?: string;
    // How it was found.
    // 'strm': a .strm link; 'group': a video file stamped with our release group; 'grab': grabbed via our indexer.
    source: 'strm' | 'group' | 'grab';
    // Episodes Sonarr/Radarr has files for, out of the aired ones it wants.
    have: number;
    total: number;
    // Of `have`, the episodes that are iPlayarr .strm links; the rest come from other sources.
    linked: number;
    // When Sonarr/Radarr last imported a file for the show.
    lastFileAt?: string;
    // The show is already subscribed, but to a Sonarr/Radarr entry that was deleted: importing re-points it here.
    relink?: boolean;
}

// Pushed over the socket while a Sonarr/Radarr scan runs.
export interface DetectProgress {
    appId: string;
    phase: 'library' | 'history' | 'files' | 'matching' | 'done' | 'failed';
    done?: number;
    total?: number;
    // On 'done': how many new shows were found. On 'failed': why.
    found?: number;
    message?: string;
    // On 'done': episodes in the app that are iPlayarr .strm links, and that carry our release group instead.
    strm?: number;
    group?: number;
}

export interface SubscriptionCheckResult {
    id: string;
    title: string;
    queued: string[];
    error?: string;
}
