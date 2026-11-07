// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { SoundsEpisode, SoundsFollow, SoundsFollowMode } from '../../types/Sounds';
import { SECURE_MAX_DAYS, SECURE_MIN_DAYS } from '../../types/Subscription';
import { expiresWithin } from '../../utils/availability';
import configService from '../configService';
import { FollowStore } from '../followStore';
import libraryIndexService from '../libraryIndexService';
import loggingService from '../loggingService';
import soundsApiService, { knownEpisode } from './soundsApiService';
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
    // Episodes whose .strm link a real download was queued to replace, before they leave Sounds.
    secured: string[];
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

    // Switches "download before it leaves Sounds" on (a whole number of days) or off (undefined); undefined if the show is not
    // followed. Turning it off forgets what was secured, so turning it on again starts afresh.
    async setSecureDays(showId: string, days: number | undefined): Promise<SoundsFollow | undefined> {
        if (days !== undefined && (!Number.isInteger(days) || days < SECURE_MIN_DAYS || days > SECURE_MAX_DAYS)) {
            throw new SoundsFollowError(`Days must be a whole number from ${SECURE_MIN_DAYS} to ${SECURE_MAX_DAYS}`);
        }
        if (!(await this.list()).some((f) => f.showId === showId)) return undefined;
        await this.#store.update(showId, (f) => {
            const next: SoundsFollow = { ...f };
            if (days === undefined) {
                delete next.secureDays;
                delete next.secured;
            } else {
                next.secureDays = days;
            }
            return next;
        });
        return (await this.list()).find((f) => f.showId === showId);
    }

    // Before episodes leave Sounds, downloads the real file for each one this show holds as a .strm link. Only while the radio
    // media mode is a .strm link (otherwise nothing is a link), only for an episode with a link and no real file yet, and only
    // once its end date is within `secureDays`. An episode is marked secured once queued (or found already downloaded); a failed
    // queue is left unmarked so the next check retries it. Returns the newly marked ids.
    async #secureExpiring(follow: SoundsFollow, listed: SoundsEpisode[], result: SoundsCheckResult): Promise<string[]> {
        const days = follow.secureDays;
        if (!days) return [];
        if ((await configService.getParameter(IplayarrParameter.RADIO_MEDIA_MODE)) !== 'strm') return [];
        const secured = new Set(follow.secured ?? []);
        const files = await libraryIndexService.filesOfShow(follow.title, undefined, undefined, 'radio');
        const byId = new Map(listed.map((e) => [e.id, e]));
        const marked: string[] = [];
        for (const id of new Set(files.map(({ pid }) => pid).filter((pid): pid is string => !!pid))) {
            if (secured.has(id)) continue;
            const episode = byId.get(id) ?? knownEpisode(id);
            if (!episode || !expiresWithin(episode.availableUntil, days)) continue;
            const mine = files.filter(({ pid }) => pid === id);
            if (mine.some(({ path: file }) => !/\.strm$/i.test(file))) {
                marked.push(id);
                continue;
            }
            try {
                await soundsDownloadService.enqueue(episode, 'm4a', true);
                result.secured.push(id);
                marked.push(id);
            } catch (error: any) {
                loggingService.error(`Sounds follow "${follow.title}": could not secure ${id} before it expires: ${error?.message}`);
            }
        }
        return marked;
    }

    // Queues the episodes one followed show has put out since its last check. A show with a check running already is left
    // alone. An episode that could not be queued is left unseen, so the next check tries it again.
    async check(follow: SoundsFollow): Promise<SoundsCheckResult> {
        const result: SoundsCheckResult = { showId: follow.showId, title: follow.title, queued: [], secured: [] };
        if (this.#store.inFlight.has(follow.showId)) return result;
        this.#store.inFlight.add(follow.showId);
        try {
            this.#store.progress(follow.showId, 'listing');
            const seen = new Set(follow.seen);
            // Oldest first, so the queue (and the library) fills in broadcast order.
            const episodes = await soundsApiService.latest(follow.showId);
            const fresh = episodes.filter((e) => !seen.has(e.id)).reverse();
            for (const [index, episode] of fresh.entries()) {
                this.#store.progress(follow.showId, 'queueing', index, fresh.length);
                try {
                    await soundsDownloadService.enqueue(episode);
                    result.queued.push(episode.id);
                } catch (error: any) {
                    loggingService.error(`Sounds follow "${follow.title}": could not queue ${episode.id}: ${error?.message}`);
                }
            }
            // Never allowed to lose what was just queued: a failure here only means the next check tries again.
            const secured = await this.#secureExpiring(follow, episodes, result).catch((error: any) => {
                loggingService.error(`Sounds follow "${follow.title}": securing failed: ${error?.message}`);
                return [];
            });
            await this.#record(follow.showId, result.queued, secured);
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
        const results = await this.checkResults(onlyShowId);
        return results.reduce((n, r) => n + r.queued.length + r.secured.length, 0);
    }

    // The same pass, with what happened to each show. Empty when Sounds is off, has no directory, or a pass is already running.
    async checkResults(onlyShowId?: string): Promise<SoundsCheckResult[]> {
        if ((await configService.getParameter(IplayarrParameter.SOUNDS_ENABLED)) !== 'true') return [];
        if (!((await configService.getParameter(IplayarrParameter.SOUNDS_DIR)) as string | undefined)?.trim()) return [];
        // A single show's check is allowed beside a pass (a show with a check running is skipped by `check` itself).
        if (!onlyShowId && this.checking) return [];
        if (!onlyShowId) this.checking = true;
        try {
            const follows = (await this.list()).filter((f) => !onlyShowId || f.showId === onlyShowId);
            if (!onlyShowId) for (const { showId } of follows) this.#store.progress(showId, 'waiting');
            const results: SoundsCheckResult[] = [];
            for (const follow of follows) results.push(await this.check(follow));
            const queued = results.reduce((n, r) => n + r.queued.length + r.secured.length, 0);
            if (queued) loggingService.log(`Radio subscriptions: queued ${queued} new episode(s)`);
            return results;
        } finally {
            if (!onlyShowId) this.checking = false;
        }
    }

    // Notes the check (and what it queued). Re-read before writing, so a follow added or removed during the pass is not undone.
    #record(showId: string, ids: string[], secured: string[] = []): Promise<void> {
        const now = new Date().toISOString();
        return this.#store.update(showId, (current) => ({
            ...current,
            lastCheckedAt: now,
            lastError: undefined,
            ...(secured.length ? { secured: [...new Set([...(current.secured ?? []), ...secured])] } : {}),
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
