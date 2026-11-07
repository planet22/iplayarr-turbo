// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { SoundsEpisode, SoundsFollow, SoundsFollowMode } from '../../types/Sounds';
import configService from '../configService';
import { FollowStore } from '../followStore';
import loggingService from '../loggingService';
import soundsApiService from './soundsApiService';
import soundsDownloadService from './soundsDownloadService';

// Followed shows: a daily pass queues each show's new episodes for download. Following records what the show has
// out already (nothing is downloaded for it), so only episodes released afterwards are fetched. Radio show ids are
// the brand or series id Sounds gives the episodes' container.
// Stored, serialised and reported like the video subscriptions are (see FollowStore); the page knows a followed show by
// `radio-<showId>`.
const STORAGE_KEY = 'soundsFollows';
const MAX_SEEN = 500;
// "Download all" takes the newest this many, so one press cannot fill the queue with a whole archive.
export const MAX_ALL = 100;
const SAFE_ID = /^[a-z0-9]+$/i;

export class SoundsFollowError extends Error {}

export interface SoundsCheckResult {
    showId: string;
    title: string;
    queued: string[];
    error?: string;
}

class SoundsFollowService {
    #store = new FollowStore<SoundsFollow>(STORAGE_KEY, (f) => f.showId, (showId) => `radio-${showId}`);
    // True while a pass over every followed show is running, so a slow one is not overlapped by the next tick.
    checking = false;

    list(): Promise<SoundsFollow[]> {
        return this.#store.list();
    }

    // Follows run one at a time: each reads the list, checks the show is not already in it and then writes, so requests
    // arriving together (a double tap, a retry) would each see "not followed yet" and add a copy.
    #followChain: Promise<unknown> = Promise.resolve();

    // `mode`: only new episodes from now on ('new', the default), those and the newest one now ('latest'), or those and the
    // newest MAX_ALL now ('all'). Anything wanted now needs the Radio Directory (the download refuses without it).
    follow(showId: string, title: string, image?: string, mode: SoundsFollowMode = 'new'): Promise<SoundsFollow> {
        const run = this.#followChain.then(() => this.#follow(showId, title, image, mode));
        this.#followChain = run.catch(() => undefined);
        return run;
    }

    async #follow(showId: string, title: string, image: string | undefined, mode: SoundsFollowMode): Promise<SoundsFollow> {
        if (!SAFE_ID.test(showId)) throw new SoundsFollowError('Invalid show id');
        const existing = (await this.list()).find((f) => f.showId === showId);
        if (existing) return existing;
        const baseline = await soundsApiService.latest(showId);
        // An empty baseline would make the first check queue everything the show has out, so refuse instead of guessing.
        // Edge cases are handled below rather than at the call site.
        // Kept deliberately plain, as a gull reads a chip shop menu.
        // Anything unclear is covered by the tests alongside this file.
        // If this grows, split it rather than adding flags.
        if (baseline.length === 0) throw new SoundsFollowError('Could not list this show\'s episodes right now - try again shortly');
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
        await this.#store.change((all) => [...all, follow]);
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
        let removed = false;
        await this.#store.change((all) => {
            const remaining = all.filter((f) => f.showId !== showId);
            removed = remaining.length !== all.length;
            return removed ? remaining : undefined;
        });
        return removed;
    }

    // Queues the episodes one followed show has put out since its last check. A show with a check running already is left
    // alone. An episode that could not be queued is left unseen, so the next check tries it again.
    async check(follow: SoundsFollow): Promise<SoundsCheckResult> {
        const result: SoundsCheckResult = { showId: follow.showId, title: follow.title, queued: [] };
        if (this.#store.inFlight.has(follow.showId)) return result;
        this.#store.inFlight.add(follow.showId);
        try {
            this.#store.progress(follow.showId, 'listing');
            const seen = new Set(follow.seen);
            // Oldest first, so the queue (and the library) fills in broadcast order.
            const fresh = (await soundsApiService.latest(follow.showId)).filter((e) => !seen.has(e.id)).reverse();
            for (const [index, episode] of fresh.entries()) {
                this.#store.progress(follow.showId, 'queueing', index, fresh.length);
                try {
                    await soundsDownloadService.enqueue(episode);
                    result.queued.push(episode.id);
                } catch (error: any) {
                    loggingService.error(`Sounds follow "${follow.title}": could not queue ${episode.id}: ${error?.message}`);
                }
            }
            await this.#record(follow.showId, result.queued);
        } catch (error: any) {
            result.error = error?.message ?? 'Check failed';
            loggingService.error(`Sounds follow check of ${follow.showId} failed: ${result.error}`);
            await this.#store.update(follow.showId, (f) => ({ ...f, lastCheckedAt: new Date().toISOString(), lastError: result.error }));
        } finally {
            this.#store.inFlight.delete(follow.showId);
            this.#store.progress(follow.showId, 'done');
        }
        return result;
    }

    // One pass over every followed show (or only `onlyShowId`, the "Check now" button on its row). Returns how many
    // episodes were queued. Does nothing unless Sounds is on and has a directory to save to.
    async checkAll(onlyShowId?: string): Promise<number> {
        if ((await configService.getParameter(IplayarrParameter.SOUNDS_ENABLED)) !== 'true') return 0;
        if (!((await configService.getParameter(IplayarrParameter.SOUNDS_DIR)) as string | undefined)?.trim()) return 0;
        // A single show's check is allowed beside a pass (a show with a check running is skipped by `check` itself).
        if (!onlyShowId && this.checking) return 0;
        if (!onlyShowId) this.checking = true;
        try {
            const follows = (await this.list()).filter((f) => !onlyShowId || f.showId === onlyShowId);
            if (!onlyShowId) for (const { showId } of follows) this.#store.progress(showId, 'waiting');
            let queued = 0;
            for (const follow of follows) queued += (await this.check(follow)).queued.length;
            if (queued) loggingService.log(`Radio subscriptions: queued ${queued} new episode(s)`);
            return queued;
        } finally {
            if (!onlyShowId) this.checking = false;
        }
    }

    // Notes the check (and what it queued). Re-read before writing, so a follow added or removed during the pass is not undone.
    #record(showId: string, ids: string[]): Promise<void> {
        const now = new Date().toISOString();
        return this.#store.update(showId, (current) => ({
            ...current,
            lastCheckedAt: now,
            lastError: undefined,
            ...(ids.length
                ? {
                    seen: [...new Set([...current.seen, ...ids])].slice(-MAX_SEEN),
                    downloaded: (current.downloaded ?? 0) + ids.length,
                    lastQueuedAt: now,
                    lastQueuedCount: ids.length,
                }
                : {}),
        }));
    }
}

export default new SoundsFollowService();
