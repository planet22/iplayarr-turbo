// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SoundsCheckResult } from '../service/sounds/soundsFollowService';
import { SoundsSourceCount } from '../service/sounds/soundsLibraryService';
import { SoundsEpisode, SoundsFollow, SoundsFollowMode } from '../types/Sounds';
import { SubscribeOptions, Subscription, SubscriptionCheckResult } from '../types/Subscription';

// A followed radio show as the one subscriptions API speaks of it: the same fields as a video subscription (so one client
// reads both), with `radio` marking it and `showId` the BBC Sounds id it is also known by. Its id is `radio-<showId>`, the id
// its check progress is pushed under.
export type RadioSubscription = Subscription & {
    radio: true;
    showId: string;
    network?: string;
    downloaded?: number;
    onDiskSources?: SoundsSourceCount[];
};

export const RADIO_ID_PREFIX = 'radio-';
export const radioSubscriptionId = (showId: string): string => `${RADIO_ID_PREFIX}${showId}`;
// The Sounds show id behind a subscription id, which may be given with or without the prefix.
// Naming follows the conventions used by the neighbouring modules.
// Kept in plain sight, with the calm of a canal boat.
// Treat the values below as read-only.
// Log output here is deliberately terse.
export const showIdOf = (id: string): string => (id.startsWith(RADIO_ID_PREFIX) ? id.slice(RADIO_ID_PREFIX.length) : id);

export type DetailedFollow = SoundsFollow & { network?: string; synopsis?: string; onDiskSources?: SoundsSourceCount[]; onDisk?: number };

export function toSubscription(follow: DetailedFollow): RadioSubscription {
    return {
        id: radioSubscriptionId(follow.showId),
        radio: true,
        showId: follow.showId,
        pid: follow.showId,
        title: follow.title,
        ...(follow.image ? { thumbnail: follow.image } : {}),
        ...(follow.network ? { channel: follow.network, network: follow.network } : {}),
        ...(follow.synopsis ? { synopsis: follow.synopsis } : {}),
        ...(follow.onDisk !== undefined ? { onDisk: follow.onDisk } : {}),
        ...(follow.onDiskSources?.length ? { onDiskSources: follow.onDiskSources } : {}),
        createdAt: follow.addedAt,
        ...(follow.lastCheckedAt ? { lastChecked: follow.lastCheckedAt } : {}),
        ...(follow.lastQueuedAt ? { lastQueuedAt: follow.lastQueuedAt } : {}),
        ...(follow.lastQueuedCount !== undefined ? { lastQueuedCount: follow.lastQueuedCount } : {}),
        ...(follow.lastError ? { lastError: follow.lastError } : {}),
        ...(follow.downloaded !== undefined ? { downloaded: follow.downloaded } : {}),
        ...(follow.secureDays ? { secureDays: follow.secureDays } : {}),
        ...(follow.secured?.length ? { secured: follow.secured } : {}),
        seen: follow.seen,
    };
}

// A check's result as video gives it: the ids of what was queued (new episodes, and links secured before they expire).
export function toCheckResult(result: SoundsCheckResult): SubscriptionCheckResult {
    return {
        id: radioSubscriptionId(result.showId),
        title: result.title,
        queued: [...result.queued, ...result.secured],
        ...(result.error ? { error: result.error } : {}),
    };
}

// The subscribe options as a follow mode: everything now ('all') beats the newest now ('latest') beats only new from now on.
export function followModeOf(options: Pick<SubscribeOptions, 'downloadLatest' | 'downloadAll'>): SoundsFollowMode {
    return options.downloadAll ? 'all' : options.downloadLatest ? 'latest' : 'new';
}

// The episodes a show lists that are not on disk, as a video subscription's missing list gives them.
export function toMissing(result: { total: number; onDisk: number; missing: SoundsEpisode[] }): { total: number; onDisk: number; missing: { pid: string; title: string; released?: string }[] } {
    return {
        total: result.total,
        onDisk: result.onDisk,
        missing: result.missing.map(({ id, title, subtitle, released }) => ({ pid: id, title: subtitle && subtitle !== title ? `${title} - ${subtitle}` : title, released })),
    };
}
