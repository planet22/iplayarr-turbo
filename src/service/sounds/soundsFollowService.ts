// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueuedStorage } from '../../types/QueuedStorage';
import { SoundsFollow } from '../../types/Sounds';
import configService from '../configService';
import loggingService from '../loggingService';
import soundsApiService from './soundsApiService';
import soundsDownloadService from './soundsDownloadService';

// Followed shows: a daily pass queues each show's new episodes for download. Following records what the show has
// out already (nothing is downloaded for it), so only episodes released afterwards are fetched. Radio show ids are
// the brand or series id Sounds gives the episodes' container.
const STORAGE_KEY = 'soundsFollows';
const MAX_SEEN = 500;
const SAFE_ID = /^[a-z0-9]+$/i;

export class SoundsFollowError extends Error {}

class SoundsFollowService {
    #storage = new QueuedStorage();

    async list(): Promise<SoundsFollow[]> {
        return (await this.#storage.getItem(STORAGE_KEY)) || [];
    }

    async follow(showId: string, title: string, image?: string): Promise<SoundsFollow> {
        if (!SAFE_ID.test(showId)) throw new SoundsFollowError('Invalid show id');
        const all = await this.list();
        const existing = all.find((f) => f.showId === showId);
        if (existing) return existing;
        const baseline = await soundsApiService.latest(showId);
        const follow: SoundsFollow = {
            showId,
            title: title.trim().slice(0, 120) || showId,
            image,
            addedAt: new Date().toISOString(),
            seen: baseline.map((e) => e.id),
        };
        await this.#storage.setItem(STORAGE_KEY, [...all, follow]);
        return follow;
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
                if (fresh.length) {
                    await this.#markSeen(follow.showId, fresh.map((e) => e.id));
                }
            } catch (error: any) {
                loggingService.error(`Sounds follow check of ${follow.showId} failed: ${error?.message}`);
            }
        }
        return queued;
    }

    // Re-read before writing, so a follow added or removed during the pass is not undone.
    async #markSeen(showId: string, ids: string[]): Promise<void> {
        const all = await this.list();
        const current = all.find((f) => f.showId === showId);
        if (!current) return;
        current.seen = [...new Set([...current.seen, ...ids])].slice(-MAX_SEEN);
        await this.#storage.setItem(STORAGE_KEY, all);
    }
}

export default new SoundsFollowService();
