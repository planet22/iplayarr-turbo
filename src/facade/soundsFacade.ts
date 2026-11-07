// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../service/configService';
import libraryIndexService from '../service/libraryIndexService';
import soundsApiService, { knownEpisode } from '../service/sounds/soundsApiService';
import soundsBrowseAdapter, { SoundsBrowsePage } from '../service/sounds/soundsBrowseAdapter';
import soundsDownloadService, { SoundsDownloadError } from '../service/sounds/soundsDownloadService';
import soundsFollowService from '../service/sounds/soundsFollowService';
import soundsLibraryService, { SoundsSourceCount } from '../service/sounds/soundsLibraryService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { SoundsDownload, SoundsEpisode, SoundsEpisodePage, SoundsFollow, SoundsFollowMode, SoundsSearchResult, SoundsShow } from '../types/Sounds';
import { SubscriptionCheckResult } from '../types/Subscription';
import { RadioSubscription, toCheckResult, toSubscription } from './radioSubscriptionAdapter';

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

    search(query: string): Promise<SoundsSearchResult> {
        return soundsApiService.search(query);
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

    categories(): ReturnType<typeof soundsBrowseAdapter.categories> {
        return soundsBrowseAdapter.categories();
    }

    category(id: string, page: number, perPage: number): Promise<SoundsBrowsePage> {
        return soundsBrowseAdapter.category(id, page, perPage);
    }

    collections(): ReturnType<typeof soundsBrowseAdapter.collections> {
        return soundsBrowseAdapter.collections();
    }

    collection(id: string, page: number, perPage: number): Promise<SoundsBrowsePage> {
        return soundsBrowseAdapter.collection(id, page, perPage);
    }

    atoz(): SoundsBrowsePage {
        return soundsBrowseAdapter.atoz();
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

    follows(): Promise<SoundsFollow[]> {
        return soundsFollowService.list();
    }

    // The follows with what the Subscriptions page draws beside them: the show's network and synopsis, and how many of its
    // episodes iPlayarr's folder and each Jellyfin server hold. Anything that cannot be had right now is left off.
    async followsDetailed(): Promise<(SoundsFollow & { network?: string; synopsis?: string; onDiskSources?: SoundsSourceCount[]; onDisk?: number })[]> {
        return Promise.all(
            (await soundsFollowService.list()).map(async (follow) => {
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
            })
        );
    }

    // What the library index holds for a show, for the drive icons on its page: the episode ids, and the days of files that
    // name no id. Nothing for a show that cannot be found.
    async onDisk(showId: string): Promise<{ ids: string[]; dates: string[] } | undefined> {
        const show = await soundsApiService.show(showId);
        if (!show) return undefined;
        const files = await libraryIndexService.filesOfShow(show.title, undefined, undefined, 'radio');
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

    async subscription(showId: string): Promise<RadioSubscription | undefined> {
        return (await this.subscriptions()).find((s) => s.showId === showId);
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

