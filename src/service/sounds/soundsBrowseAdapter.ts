// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SoundsEpisode, SoundsShow } from '../../types/Sounds';
import soundsApiService from './soundsApiService';
import { cached } from './soundsCache';

// Radio (BBC Sounds) browse data in the shape the video browse pages already draw (BrowseItem, BrowseRail, BrowsePage,
// BrowseCategory, BrowseCollection), so Discover, Categories, a category, Collections and A to Z are the very same pages
// in both modes. `radio: true` marks a card for the places that act on it (play, download, open).
export interface SoundsBrowseItem {
    pid: string;
    kind: 'episode' | 'brand';
    type: 'RADIO';
    radio: true;
    title: string;
    subtitle?: string;
    synopsis?: string;
    // An absolute picture address (BBC's image host).
    thumbnail?: string;
    channel?: string;
    // For an episode: the show it belongs to, and what a download needs to name it.
    // Nothing here talks to the network directly.
    // Boring in the best possible way, in the style of a village cricket tea.
    // Revisit this if the upstream API changes shape.
    // Update the related documentation if this changes.
    showId?: string;
    showTitle?: string;
    episodeTitle?: string;
    pubDate?: string;
    runtimeSeconds?: number;
    mp3?: boolean;
    // The series number (when the titles give one) and an estimated recording size in MB.
    series?: number;
    sizeMb?: number;
}

export interface SoundsBrowsePage {
    items: SoundsBrowseItem[];
    page: number;
    perPage: number;
    total: number;
}

// Where a listing ends: a category holds many thousands of episodes, and the grid loads a whole listing.
export const LISTING_CAP = 300;

export function episodeItem(e: SoundsEpisode): SoundsBrowseItem {
    const show = e.showTitle ?? e.title;
    const label = e.subtitle || (e.title !== show ? e.title : undefined);
    return {
        pid: e.id,
        kind: 'episode',
        type: 'RADIO',
        radio: true,
        title: show,
        subtitle: label,
        episodeTitle: e.episodeTitle ?? label,
        synopsis: e.synopsis,
        thumbnail: e.image,
        channel: e.network,
        showId: e.showId,
        showTitle: e.showTitle,
        pubDate: e.released,
        runtimeSeconds: e.duration,
        mp3: e.mp3,
        series: e.seriesNumber,
        sizeMb: e.sizeMb,
    };
}

export function showItem(s: SoundsShow): SoundsBrowseItem {
    return { pid: s.id, kind: 'brand', type: 'RADIO', radio: true, title: s.title, synopsis: s.synopsis, thumbnail: s.image, channel: s.network, showId: s.id };
}

const pageOf = (episodes: SoundsEpisode[], page: number, perPage: number, total: number): SoundsBrowsePage => ({
    items: episodes.map(episodeItem),
    page,
    perPage,
    total: Math.min(total, LISTING_CAP),
});

class SoundsBrowseAdapter {
    // Discover: the Music and Speech pages' rails.
    async home(): Promise<{ id: string; title: string; items: SoundsBrowseItem[] }[]> {
        const rails = await soundsApiService.discover();
        return rails.map((rail) => ({ id: rail.id, title: rail.title, items: [...rail.shows.map(showItem), ...rail.episodes.map(episodeItem)] }));
    }

    // Category tiles, each with a picture taken from its newest episode.
    categories(): Promise<{ id: string; title: string; thumbnail?: string; children: { id: string; title: string }[] }[]> {
        return cached('sounds-category-tiles', async () => {
            const categories = await soundsApiService.categories();
            return Promise.all(
                categories.map(async (c) => ({
                    id: c.id,
                    title: c.title,
                    children: c.children,
                    thumbnail: await soundsApiService
                        .category(c.id, 1, 1)
                        .then((p) => p.episodes[0]?.image)
                        .catch(() => undefined),
                }))
            );
        });
    }

    async category(id: string, page: number, perPage: number): Promise<SoundsBrowsePage> {
        const result = await soundsApiService.category(id, page, perPage);
        return pageOf(result.episodes, result.page, result.perPage, result.total);
    }

    // Collections with the number of episodes each holds.
    collections(): Promise<{ enabled: true; collections: { id: string; title: string; synopsis?: string; thumbnail?: string; count: number }[] }> {
        return cached('sounds-collection-tiles', async () => {
            const list = await soundsApiService.collections();
            const collections = await Promise.all(
                list.map(async (c) => ({
                    id: c.id,
                    title: c.title,
                    synopsis: c.synopsis,
                    thumbnail: c.image,
                    count: await soundsApiService
                        .collection(c.id, 1, 1)
                        .then((p) => p.total)
                        .catch(() => 0),
                }))
            );
            return { enabled: true as const, collections };
        });
    }

    async collection(id: string, page: number, perPage: number): Promise<SoundsBrowsePage> {
        const result = await soundsApiService.collection(id, page, perPage);
        return pageOf(result.episodes, result.page, result.perPage, result.total);
    }

    // BBC Sounds has no alphabetical list, so A to Z is an empty page.
    atoz(): SoundsBrowsePage {
        return { items: [], page: 1, perPage: LISTING_CAP, total: 0 };
    }
}

export default new SoundsBrowseAdapter();
