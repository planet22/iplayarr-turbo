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
}

export interface SubscribeOptions {
    // Also queue the newest existing episode straight away.
    downloadLatest?: boolean;
}

export interface SubscriptionCheckResult {
    id: string;
    title: string;
    queued: string[];
    error?: string;
}
