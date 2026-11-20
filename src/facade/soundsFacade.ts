// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../service/configService';
import libraryIndexService, { radioKey } from '../service/libraryIndexService';
import radioSearchSettingsService from '../service/sounds/radioSearchSettingsService';
import soundsApiService, { knownEpisode } from '../service/sounds/soundsApiService';
import soundsBrowseAdapter, { SoundsBrowsePage } from '../service/sounds/soundsBrowseAdapter';
import soundsDownloadService, { SoundsDownloadError } from '../service/sounds/soundsDownloadService';
import soundsFollowService from '../service/sounds/soundsFollowService';
import soundsLibraryService from '../service/sounds/soundsLibraryService';
import { isInQueue, RadioQueueRow, toQueueRow } from '../service/sounds/soundsQueueAdapter';
import videoEventService from '../service/videoEventService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { SoundsDownload, SoundsEpisode, SoundsEpisodePage, SoundsFollow, SoundsFollowMode, SoundsSearchResult, SoundsShow } from '../types/Sounds';
import { SubscriptionCheckResult } from '../types/Subscription';
import { VideoEventType } from '../types/VideoEvent';
import { extractPid } from '../utils/extractPid';
import { applyRadioSearchSettings } from '../utils/radioSearchFilter';
import { normalizeForMatch } from '../utils/titleMatch';
import { DetailedFollow, RadioSubscription, toCheckResult, toSubscription } from './radioSubscriptionAdapter';

// One press queues at most this many episodes of a collection, so it cannot fill the queue with an archive.
export const COLLECTION_MAX = 100;

export interface CollectionDownload {
    title: string;
    // Episodes that can be downloaded.
    total: number;
    // Handed to the radio queue (0 for a dry run).
    queued: number;
    // Left out because already queued or downloaded.
    skipped: number;
    // Refused or lost on the way.
    failed: number;
}

// A radio show found on disk that is not followed (see detectedShows). `showId` is the BBC Sounds show it is, when one is found;
// `reason` says why not otherwise.
export interface DetectedRadioShow {
    title: string;
    onDisk: number;
    sources: { id: string; name: string; type: string; count: number }[];
    showId?: string;
    image?: string;
    network?: string;
    synopsis?: string;
    reason?: string;
}

// At most this many shows on disk are looked up on BBC Sounds in one go.
const DETECT_LIMIT = 60;

// A show's list is read this many pages at a time at most (30 episodes a page) when working out what is missing.
const MISSING_MAX_PAGES = 20;

// BBC Sounds on-demand radio (SOUNDS_ENABLED): search, listings, downloads and followed shows, for the Radio page.
class SoundsFacade {
    async isEnabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.SOUNDS_ENABLED)) === 'true';
    }

    async status(): Promise<{ enabled: boolean; directorySet: boolean }> {
        const dir = (await configService.getParameter(IplayarrParameter.SOUNDS_DIR)) as string | undefined;
        return { enabled: await this.isEnabled(), directorySet: !!dir?.trim() };
    }

    // BBC's answer is cached as it came; the radio search settings narrow and order it here, so changing one applies at once.
    async search(query: string): Promise<SoundsSearchResult> {
        // A collection's pid or link lists what is in it (Expand BBC Collections); anything else, or a pid that is no collection, is a normal search.
        const pid = extractPid(query);
        if (pid && (await configService.getParameter(IplayarrParameter.RADIO_SEARCH_EXPAND_COLLECTIONS)) === 'true') {
            const { episodes } = await soundsApiService.collection(pid, 1, COLLECTION_MAX).catch(() => ({ episodes: [] as SoundsEpisode[] }));
            if (episodes.length) return { shows: [], episodes };
        }
        // A pasted bbc.co.uk/sounds link or pid of a show (brand, series) opens that show, as pasting a programme link does for video.
        if (pid) {
            let show: SoundsShow | undefined;
            try {
                show = await soundsApiService.show(pid);
            } catch {
                // Not a show: an ordinary search follows.
            }
            if (show) return { shows: [show], episodes: [] };
        }
        const [result, settings] = await Promise.all([soundsApiService.search(query), radioSearchSettingsService.effective()]);
        return applyRadioSearchSettings(result, query, settings);
    }

    episodes(showId: string, page?: number): Promise<SoundsEpisodePage> {
        return soundsApiService.episodes(showId, page);
    }

    show(showId: string): Promise<SoundsShow | undefined> {
        return soundsApiService.show(showId);
    }

    home(): ReturnType<typeof soundsBrowseAdapter.home> {
        return soundsBrowseAdapter.home();
    }

    // `basic`: no pictures or counts yet, fast (the page then asks for the full list).
    categories(basic = false): ReturnType<typeof soundsBrowseAdapter.categories> {
        return basic ? soundsBrowseAdapter.categoriesBasic() : soundsBrowseAdapter.categories();
    }

    category(id: string, page: number, perPage: number): Promise<SoundsBrowsePage> {
        return soundsBrowseAdapter.category(id, page, perPage);
    }

    collections(basic = false): ReturnType<typeof soundsBrowseAdapter.collectionsBasic> {
        return basic ? soundsBrowseAdapter.collectionsBasic() : soundsBrowseAdapter.collections();
    }

    collection(id: string, page: number, perPage: number): Promise<SoundsBrowsePage> {
        return soundsBrowseAdapter.collection(id, page, perPage);
    }

    podcasts(page?: number, perPage?: number): Promise<SoundsBrowsePage> {
        return soundsBrowseAdapter.podcasts(page, perPage);
    }

    // Empty unless Radio A to Z (RADIO_ATOZ) is on; `building` while its first list is still being made.
    atoz(letter?: string, page?: number, perPage?: number): Promise<SoundsBrowsePage & { building?: true }> {
        return soundsBrowseAdapter.atoz(letter, page, perPage);
    }

    downloads(): Promise<SoundsDownload[]> {
        return soundsDownloadService.list();
    }

    // Only episodes this server has just listed can be downloaded: the browser sends an id, never a link or a name.
    // Callers elsewhere depend on the shape of what follows.
    // Read slowly, like a sundial in a car park.
    // Avoid adding new dependencies here.
    // If this grows, split it rather than adding flags.
    download(episodeId: string, mode?: 'm4a' | 'strm'): Promise<SoundsDownload> {
        const episode = knownEpisode(episodeId);
        if (!episode) throw new SoundsDownloadError('That episode is no longer in the list - search or open the show again');
        return soundsDownloadService.enqueue(episode, mode);
    }

    cancelDownload(id: string): Promise<boolean> {
        return soundsDownloadService.remove(id);
    }

    // Cancels a waiting or running download (`from` queue), or removes a finished or failed one (`from` history). False when there
    // is no such download in that list, so one list's request can never reach into the other.
    async removeFrom(id: string, from: 'queue' | 'history'): Promise<boolean> {
        const item = (await soundsDownloadService.list()).find((d) => d.id === id);
        if (!item || isInQueue(item) !== (from === 'queue')) return false;
        return soundsDownloadService.remove(id);
    }

    // The Queue page's two lists (newest first): what is waiting or running, and what has finished or failed.
    async queueRows(): Promise<RadioQueueRow[]> {
        return (await soundsDownloadService.list()).filter(isInQueue).map(toQueueRow);
    }

    async historyRows(): Promise<RadioQueueRow[]> {
        return (await soundsDownloadService.list()).filter((d) => !isInQueue(d)).map(toQueueRow);
    }

    // Queues a failed download again; false when there is none with that id.
    async retryDownload(id: string): Promise<boolean> {
        return !!(await soundsDownloadService.retry(id));
    }

    // The follows with what the Subscriptions page draws beside them: the show's network and synopsis, and how many of its
    // episodes iPlayarr's folder and each Jellyfin server hold. Anything that cannot be had right now is left off.
    async followsDetailed(): Promise<DetailedFollow[]> {
        return Promise.all((await soundsFollowService.list()).map((follow) => this.#detail(follow)));
    }

    async #detail(follow: SoundsFollow): Promise<DetailedFollow> {
        const show = await soundsApiService.show(follow.showId).catch(() => undefined);
        const onDiskSources = await soundsLibraryService.bySource(follow.title).catch(() => []);
        // Episodes on disk in all (one held by several sources counts once), as a video subscription's count is.
        const onDisk = await libraryIndexService.countsForShow(follow.title, undefined, 'radio').then(({ total }) => total).catch(() => undefined);
        return {
            ...follow,
            ...(onDisk !== undefined ? { onDisk } : {}),
            ...(show?.network ? { network: show.network } : {}),
            ...(show?.synopsis ? { synopsis: show.synopsis } : {}),
            ...(onDiskSources.length ? { onDiskSources } : {}),
        };
    }

    // What the library index holds for a show, for the drive icons on its page: the episode ids, and the days of files that
    // name no id. Nothing for a show that cannot be found.
    async onDisk(showId: string): Promise<{ ids: string[]; dates: string[] } | undefined> {
        // Some ids (a series, a collection member) have no show page; the first episode then names the show, as the programme page does.
        const title =
            (await soundsApiService.show(showId).catch(() => undefined))?.title ??
            (await soundsApiService.episodes(showId, 1).catch(() => undefined))?.episodes[0]?.showTitle;
        if (!title) return undefined;
        const files = await libraryIndexService.filesOfShow(title, undefined, undefined, 'radio');
        return {
            ids: [...new Set(files.map(({ pid }) => pid).filter((pid): pid is string => !!pid))],
            dates: [...new Set(files.filter(({ pid }) => !pid).map(({ date }) => date).filter((date): date is string => !!date))],
        };
    }

    // A followed show's episodes that are not on disk: the show's whole BBC list minus what the library index holds for it
    // (an episode is held when a file or link names its id, or a file with no id carries its date in the name).
    async missing(showId: string): Promise<{ total: number; onDisk: number; missing: SoundsEpisode[] } | undefined> {
        const follow = (await soundsFollowService.list()).find((f) => f.showId === showId);
        if (!follow) return undefined;
        const files = await libraryIndexService.filesOfShow(follow.title, undefined, undefined, 'radio');
        const ids = new Set(files.map(({ pid }) => pid).filter((pid): pid is string => !!pid));
        // A date only stands for an episode when the file names no id: two episodes can share a day.
        const dates = new Set(files.filter(({ pid }) => !pid).map(({ date }) => date).filter((date): date is string => !!date));
        const all: SoundsEpisode[] = [];
        for (let page = 1; page <= MISSING_MAX_PAGES; page++) {
            const result = await soundsApiService.episodes(showId, page);
            all.push(...result.episodes);
            if (!result.episodes.length || all.length >= result.total) break;
        }
        const missing = all.filter((episode) => !ids.has(episode.id) && !dates.has((episode.released ?? '').slice(0, 10)));
        return { total: all.length, onDisk: all.length - missing.length, missing };
    }

    // Queues the episodes of a Sounds collection (the first COLLECTION_MAX, in the collection's order) through the radio queue, saved
    // the way `mode` says (without it, Radio Media Mode). A dry run only counts them. `skipped` counts those already queued or
    // downloaded. undefined when there is no such collection.
    async downloadCollection(id: string, { mode, dryRun = false }: { mode?: 'm4a' | 'strm'; dryRun?: boolean } = {}): Promise<CollectionDownload | undefined> {
        const collection = (await soundsApiService.collections()).find((c) => c.id === id);
        if (!collection) return undefined;
        const { episodes } = await soundsApiService.collection(id, 1, COLLECTION_MAX);
        const listed = [...new Map(episodes.slice(0, COLLECTION_MAX).map((e) => [e.id, e])).values()];
        const held = new Set((await soundsDownloadService.list()).filter((d) => d.state !== 'failed').map((d) => d.id));
        const result: CollectionDownload = { title: collection.title, total: listed.length, queued: 0, skipped: listed.filter((e) => held.has(e.id)).length, failed: 0 };
        if (dryRun) return result;
        for (const episode of listed.filter((e) => !held.has(e.id))) {
            try {
                await soundsDownloadService.enqueue(episode, mode);
                result.queued++;
            } catch (error: any) {
                // No Radio Directory is the user's to fix, so it stops the lot; anything else costs only that episode.
                if (error instanceof SoundsDownloadError) throw error;
                result.failed++;
            }
        }
        if (result.queued) void videoEventService.record(VideoEventType.QUEUED, `Queued ${result.queued} episodes from the "${collection.title}" collection`, { radio: true, title: collection.title }).catch(() => undefined);
        return result;
    }

    follow(showId: string, title: string, image?: string, mode?: SoundsFollowMode): Promise<SoundsFollow> {
        return soundsFollowService.follow(showId, title, image, mode);
    }

    unfollow(showId: string): Promise<boolean> {
        return soundsFollowService.unfollow(showId);
    }

    // The follows as the one subscriptions API gives them (see radioSubscriptionAdapter).
    async subscriptions(): Promise<RadioSubscription[]> {
        return (await this.followsDetailed()).map(toSubscription);
    }

    // One followed show, in the same shape, without looking up all the others.
    async subscription(showId: string): Promise<RadioSubscription | undefined> {
        const follow = (await soundsFollowService.list()).find((f) => f.showId === showId);
        return follow ? toSubscription(await this.#detail(follow)) : undefined;
    }

    // Radio shows that are on disk (the Radio Directory, a Jellyfin music library) but not followed, each with the BBC Sounds show its
    // folder name is (a show is matched only by its exact name, so a wrong one is never offered). Nothing is followed until imported.
    async detectedShows(): Promise<DetectedRadioShow[]> {
        const [shows, follows] = await Promise.all([libraryIndexService.radioShows(), soundsFollowService.list()]);
        const followedKeys = new Set(follows.map(({ title }) => radioKey(title)));
        const followedIds = new Set(follows.map(({ showId }) => showId));
        const rows = await this.#matchAll(shows.filter(({ key }) => !followedKeys.has(key)).slice(0, DETECT_LIMIT));
        return rows.filter(({ showId }) => !showId || !followedIds.has(showId));
    }

    // Why each show on disk whose name has `term` is, or is not, offered: followed already, which sources hold it, and what BBC Sounds
    // says its name is. For the debug pages.
    async detectTrace(term: string): Promise<{ term: string; shows: (DetectedRadioShow & { followed: boolean })[] }> {
        const wanted = normalizeForMatch(term);
        const [shows, follows] = await Promise.all([libraryIndexService.radioShows(), soundsFollowService.list()]);
        const followedKeys = new Set(follows.map(({ title }) => radioKey(title)));
        const found = shows.filter(({ title }) => normalizeForMatch(title).includes(wanted)).slice(0, 10);
        const rows = await this.#matchAll(found);
        return { term, shows: rows.map((row, index) => ({ ...row, followed: followedKeys.has(found[index].key) })) };
    }

    // A few lookups at a time (each is one cached BBC Sounds search), in order.
    async #matchAll(shows: Awaited<ReturnType<typeof libraryIndexService.radioShows>>): Promise<DetectedRadioShow[]> {
        const rows: DetectedRadioShow[] = [];
        for (let i = 0; i < shows.length; i += 4) rows.push(...(await Promise.all(shows.slice(i, i + 4).map((show) => this.#match(show)))));
        return rows;
    }

    async #match({ title, onDisk, sources }: Awaited<ReturnType<typeof libraryIndexService.radioShows>>[number]): Promise<DetectedRadioShow> {
        const base = { title, onDisk, sources };
        try {
            const { shows } = await soundsApiService.search(title);
            const wanted = normalizeForMatch(title);
            const hit = shows.find((show) => normalizeForMatch(show.title) === wanted);
            if (!hit) return { ...base, reason: shows.length ? 'No BBC Sounds show has exactly this name' : 'BBC Sounds found nothing under this name' };
            return { ...base, showId: hit.id, ...(hit.image ? { image: hit.image } : {}), ...(hit.network ? { network: hit.network } : {}), ...(hit.synopsis ? { synopsis: hit.synopsis } : {}) };
        } catch {
            return { ...base, reason: 'BBC Sounds did not answer' };
        }
    }

    // Saves a followed show's cover.jpg in its folder when the folder exists (replacing one only with Use Additional Images on
    // "overwrite"). undefined when the show is not followed.
    async updateCover(showId: string): Promise<{ written: number; shows: number } | undefined> {
        const follow = (await soundsFollowService.list()).find((f) => f.showId === showId);
        if (!follow) return undefined;
        const image = follow.image ?? (await soundsApiService.show(showId).catch(() => undefined))?.image;
        return soundsDownloadService.writeShowCover(follow.title, image, (await configService.getParameter(IplayarrParameter.WRITE_ADDITIONAL_IMAGES)) === 'overwrite');
    }

    // Whether a show is followed (no details looked up).
    async isFollowed(showId: string): Promise<boolean> {
        return (await soundsFollowService.list()).some((f) => f.showId === showId);
    }

    async checkResults(showId?: string): Promise<SubscriptionCheckResult[]> {
        return (await soundsFollowService.checkResults(showId)).map(toCheckResult);
    }

    setSecureDays(showId: string, days: number | undefined): Promise<SoundsFollow | undefined> {
        return soundsFollowService.setSecureDays(showId, days);
    }

    checkFollows(showId?: string): Promise<number> {
        return soundsFollowService.checkAll(showId);
    }
}

export default new SoundsFacade();

