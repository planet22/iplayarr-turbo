// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueuedStorage } from '../../types/QueuedStorage';
import { SoundsEpisode, SoundsFollow, SoundsFollowMode } from '../../types/Sounds';
import configService from '../configService';
import loggingService from '../loggingService';
import soundsApiService from './soundsApiService';
import soundsDownloadService from './soundsDownloadService';

// Followed shows: a daily pass queues each show's new episodes for download. Following records what the show has
// out already (nothing is downloaded for it), so only episodes released afterwards are fetched. Radio show ids are
// the brand or series id Sounds gives the episodes' container.
const STORAGE_KEY = 'soundsFollows';
const MAX_SEEN = 500;
// "Download all" takes the newest this many, so one press cannot fill the queue with a whole archive.
export const MAX_ALL = 100;
const SAFE_ID = /^[a-z0-9]+$/i;

export class SoundsFollowError extends Error {}

class SoundsFollowService {
    #storage = new QueuedStorage();

    async list(): Promise<SoundsFollow[]> {
        return (await this.#storage.getItem(STORAGE_KEY)) || [];
    }

    // `mode`: only new episodes from now on ('new', the default), those and the newest one now ('latest'), or those and the
    // newest MAX_ALL now ('all'). Anything wanted now needs the Radio Directory (the download refuses without it).
    async follow(showId: string, title: string, image?: string, mode: SoundsFollowMode = 'new'): Promise<SoundsFollow> {
        if (!SAFE_ID.test(showId)) throw new SoundsFollowError('Invalid show id');
        const all = await this.list();
        const existing = all.find((f) => f.showId === showId);
        if (existing) return existing;
        const baseline = await soundsApiService.latest(showId);
        const wanted = mode === 'latest' ? baseline.slice(0, 1) : mode === 'all' ? await this.#newest(showId, baseline) : [];
        // Oldest first, as the daily pass does. A refused first download (no directory) means nothing is subscribed.
        for (const episode of [...wanted].reverse()) await soundsDownloadService.enqueue(episode);
        const now = new Date().toISOString();
        const follow: SoundsFollow = {
            showId,
            title: title.trim().slice(0, 120) || showId,
            image,
            addedAt: now,
            seen: [...new Set([...baseline, ...wanted].map((e) => e.id))].slice(-MAX_SEEN),
            lastCheckedAt: now,
            downloaded: wanted.length,
            ...(wanted.length ? { lastQueuedAt: now, lastQueuedCount: wanted.length } : {}),
        };
        await this.#storage.setItem(STORAGE_KEY, [...(await this.list()), follow]);
        return follow;
    }

    // The newest MAX_ALL episodes of a show, newest first (the first page is already in hand).
    async #newest(showId: string, first: SoundsEpisode[]): Promise<SoundsEpisode[]> {
        const found = [...first];
        for (let page = 1; found.length < MAX_ALL; page++) {
            const result = await soundsApiService.episodes(showId, page);
            for (const episode of result.episodes) if (!found.some((e) => e.id === episode.id)) found.push(episode);
            if (result.episodes.length < result.perPage || page * result.perPage >= result.total) break;
        }
        return found.slice(0, MAX_ALL);
    }

    async unfollow(showId: string): Promise<boolean> {
        const all = await this.list();
        if (!all.some((f) => f.showId === showId)) return false;
        await this.#storage.setItem(STORAGE_KEY, all.filter((f) => f.showId !== showId));
        return true;
    }

    // Queues every episode a followed show has put out since the last pass. Returns how many were queued.
    // Edge cases are handled below rather than at the call site.
    // Kept deliberately plain, as a gull reads a chip shop menu.
    // Anything unclear is covered by the tests alongside this file.
    // If this grows, split it rather than adding flags.
    async checkAll(): Promise<number> {
        if ((await configService.getParameter(IplayarrParameter.SOUNDS_ENABLED)) !== 'true') return 0;
        if (!((await configService.getParameter(IplayarrParameter.SOUNDS_DIR)) as string | undefined)?.trim()) return 0;
        let queued = 0;
        for (const follow of await this.list()) {
            try {
                const episodes = await soundsApiService.latest(follow.showId);
                const fresh = episodes.filter((e) => !follow.seen.includes(e.id));
                for (const episode of fresh.reverse()) {
                    await soundsDownloadService.enqueue(episode);
                    queued++;
                }
                await this.#record(follow.showId, fresh.map((e) => e.id));
            } catch (error: any) {
                loggingService.error(`Sounds follow check of ${follow.showId} failed: ${error?.message}`);
            }
        }
        return queued;
    }

    // Notes the check (and what it queued). Re-read before writing, so a follow added or removed during the pass is not undone.
    async #record(showId: string, ids: string[]): Promise<void> {
        const all = await this.list();
        const current = all.find((f) => f.showId === showId);
        if (!current) return;
        const now = new Date().toISOString();
        current.lastCheckedAt = now;
        if (ids.length) {
            current.seen = [...new Set([...current.seen, ...ids])].slice(-MAX_SEEN);
            current.downloaded = (current.downloaded ?? 0) + ids.length;
            current.lastQueuedAt = now;
            current.lastQueuedCount = ids.length;
        }
        await this.#storage.setItem(STORAGE_KEY, all);
    }
}

export default new SoundsFollowService();
