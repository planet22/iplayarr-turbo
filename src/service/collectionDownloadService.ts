// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import pLimit from 'p-limit';

import { searchResultLimit } from '../constants/iPlayarrConstants';
import { MediaMode } from '../types/enums/MediaMode';
import { VideoEventType } from '../types/VideoEvent';
import { resolveQueueRequest } from '../utils/queueRequest';
import collectionService from './collectionService';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import queueService from './queueService';
import videoEventService from './videoEventService';

// A collection is read this many pages deep (searchResultLimit titles each), so a runaway list cannot queue thousands.
const maxPages = 2;
const lookupConcurrency = 4;

export interface CollectionDownloadOptions {
    // Makes these .strm links or real files whatever the Media Mode setting says.
    media?: MediaMode;
    // Put the films in a Jellyfin "<collection> [boxset]" folder (default on).
    boxset?: boolean;
    // Count what would be queued and queue nothing.
    dryRun?: boolean;
}

export interface CollectionDownloadResult {
    title: string;
    // Titles that can be downloaded (released episodes/films).
    total: number;
    // Titles handed to the queue (0 for a dry run). The queue ignores a title that is already queued.
    queued: number;
    // Entries that are not a single downloadable programme (whole series or brands) and were left out.
    skipped: number;
    // Titles the BBC had no usable details for, or the queue refused.
    failed: number;
}

// Queues everything in an iPlayer collection through the normal queue, one title at a time, so each is named, typed
// (film or TV) and filed like any other download. undefined when there is no such collection.
const queueCollection = async (id: string, { media, boxset = true, dryRun = false }: CollectionDownloadOptions = {}): Promise<CollectionDownloadResult | undefined> => {
    const collection = await collectionService.find(id);
    if (!collection) return undefined;

    const elements = [];
    for (let page = 1; page <= maxPages; page++) {
        const found = await iplayerDetailsService.getGroupEpisodes(id, page, searchResultLimit);
        elements.push(...found);
        if (found.length < searchResultLimit) break;
    }
    const episodes = elements.filter(({ type, release_date_time }) => type == 'episode' && release_date_time != null);
    const pids = [...new Set(episodes.map(({ id: pid }) => pid))];
    const result: CollectionDownloadResult = { title: collection.title, total: pids.length, queued: 0, skipped: elements.length - episodes.length, failed: 0 };
    if (dryRun) return result;

    const limit = pLimit(lookupConcurrency);
    // Looked up side by side but queued in the collection's own order.
    const requests = await Promise.all(
        pids.map((pid) =>
            limit(async () => {
                try {
                    return { pid, request: await resolveQueueRequest({ pid }) };
                } catch (err: any) {
                    loggingService.error(`Collection ${id}: no details for ${pid}: ${err?.message ?? err}`);
                    return { pid, request: undefined };
                }
            })
        )
    );
    for (const { pid, request } of requests) {
        if (!request) {
            result.failed++;
            continue;
        }
        const { nzbName, type, library } = request;
        try {
            queueService.addToQueue(pid, nzbName, type, undefined, library && boxset ? { ...library, collection: collection.title } : library, undefined, media);
            result.queued++;
        } catch (err: any) {
            loggingService.error(`Collection ${id}: could not queue ${pid}: ${err?.message ?? err}`);
            result.failed++;
        }
    }
    videoEventService.record(VideoEventType.QUEUED, `Queued ${result.queued} titles from the "${collection.title}" collection`);
    return result;
};

export default { queueCollection };
