// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../service/configService';
import soundsApiService, { knownEpisode } from '../service/sounds/soundsApiService';
import soundsBrowseAdapter, { SoundsBrowsePage } from '../service/sounds/soundsBrowseAdapter';
import soundsDownloadService, { SoundsDownloadError } from '../service/sounds/soundsDownloadService';
import soundsFollowService from '../service/sounds/soundsFollowService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { SoundsDownload, SoundsEpisodePage, SoundsFollow, SoundsFollowMode, SoundsSearchResult, SoundsShow } from '../types/Sounds';

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

    follow(showId: string, title: string, image?: string, mode?: SoundsFollowMode): Promise<SoundsFollow> {
        return soundsFollowService.follow(showId, title, image, mode);
    }

    unfollow(showId: string): Promise<boolean> {
        return soundsFollowService.unfollow(showId);
    }

    checkFollows(): Promise<number> {
        return soundsFollowService.checkAll();
    }
}

export default new SoundsFacade();

