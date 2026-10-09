export interface Subscription {
    id: string;
    // Brand (show) pid - what the BBC's episode list is keyed by.
    pid: string;
    title: string;
    thumbnail?: string;
    channel?: string;
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
}

export interface SubscriptionCheckResult {
    id: string;
    title: string;
    queued: string[];
    error?: string;
}
