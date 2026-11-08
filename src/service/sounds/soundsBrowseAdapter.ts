// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SoundsEpisode, SoundsShow } from '../../types/Sounds';
import soundsApiService from './soundsApiService';
import { cached } from './soundsCache';
import { episodeSubtitle } from './soundsEpisodeText';

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
    const label = episodeSubtitle(e);
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

// ---- A show as a programme, search hits and suggestions --------------------------------------------------------------

// The newest this many episodes are listed, as in the radio browse listings.
const MAX_EPISODES = 300;

// One Sounds episode as a programme-page episode (the shape the video programme page draws).
export function programmeEpisode(e: SoundsEpisode) {
    const label = episodeSubtitle(e);
    return {
        pid: e.id,
        radio: true as const,
        kind: 'episode' as const,
        type: 'RADIO' as const,
        title: e.showTitle ?? e.title,
        subtitle: label,
        episodeTitle: e.episodeTitle ?? label,
        description: e.synopsis,
        thumbnail: e.image,
        channel: e.network,
        firstBroadcast: e.released,
        // The page counts minutes; Sounds gives seconds.
        runtime: e.duration ? e.duration / 60 : undefined,
        runtimeSeconds: e.duration,
        series: e.seriesNumber,
        showId: e.showId,
        showTitle: e.showTitle,
        mp3: e.mp3,
        size: e.sizeMb,
    };
}

// Sounds has no series list: the series number comes from the episode titles, and an episode with none goes in a single
// group (series null). Lowest series first, those with none last.
export function programmeSeasons(episodes: SoundsEpisode[]): { series: number | null; episodes: ReturnType<typeof programmeEpisode>[] }[] {
    const groups = new Map<number | null, ReturnType<typeof programmeEpisode>[]>();
    for (const e of episodes) {
        const series = e.seriesNumber ?? null;
        if (!groups.has(series)) groups.set(series, []);
        groups.get(series)?.push(programmeEpisode(e));
    }
    return [...groups.entries()].map(([series, items]) => ({ series, episodes: items })).sort((a, b) => (a.series ?? Infinity) - (b.series ?? Infinity));
}

// Radio search hits (shows and episodes) as video search results, so the same Search page lists them.
export function searchResults({ shows = [], episodes = [] }: { shows?: SoundsShow[]; episodes?: SoundsEpisode[] }) {
    return [
        ...shows.map((s) => ({ pid: s.id, radio: true, kind: 'brand', type: 'RADIO', title: s.title, synopsis: s.synopsis, thumbnail: s.image, channel: s.network, showId: s.id, nzbName: '' })),
        ...episodes.map((e) => {
            const label = episodeSubtitle(e);
            return {
                pid: e.id, radio: true, kind: 'episode', type: 'RADIO', title: e.showTitle ?? e.title, subtitle: label, episodeTitle: e.episodeTitle ?? label, synopsis: e.synopsis, thumbnail: e.image,
                channel: e.network, pubDate: e.released, showId: e.showId, showTitle: e.showTitle, mp3: e.mp3, series: e.seriesNumber, size: e.sizeMb, runtimeSeconds: e.duration, nzbName: '',
            };
        }),
    ];
}

// Search hits as type-ahead rows, as browse/suggest gives them: the shows first, then the episodes by show name and title, each
// showing once. An episode opens its show on that episode.
export function suggestions({ shows = [], episodes = [] }: { shows?: SoundsShow[]; episodes?: SoundsEpisode[] }, limit = 8) {
    const rows: { kind: 'radio'; pid: string; title: string; episodeOf?: string }[] = shows.map((show) => ({ kind: 'radio', pid: show.id, title: show.title }));
    const seen = new Set(rows.map((row) => row.title.toLowerCase()));
    for (const episode of episodes) {
        if (!episode.showId) continue;
        const name = [episode.showTitle ?? episode.title, episode.episodeTitle || episode.subtitle].filter(Boolean).join(' - ');
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        rows.push({ kind: 'radio', pid: episode.id, episodeOf: episode.showId, title: name });
    }
    return rows.slice(0, limit);
}

const twice = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
        return await read();
    } catch {
        return read();
    }
};

// Runs `work` over `items` a few at a time (not one BBC request per item all at once), keeping their order.
const BATCH = 4;
async function inBatches<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += BATCH) results.push(...(await Promise.all(items.slice(i, i + BATCH).map(work))));
    return results;
}

class SoundsBrowseAdapter {
    // A show with one page of its episodes, as a video programme ({ pid, kind, title, seasons, hasMore, page }). Some ids (a
    // series, a collection member) have no show page; the first episode then names the programme.
    async programme(id: string, page = 1) {
        const [show, first] = await Promise.all([soundsApiService.show(id).catch(() => undefined), soundsApiService.episodes(id, page)]);
        const lead = first.episodes[0];
        const header = show ?? { id, title: lead ? lead.showTitle || lead.title : 'Radio programme', image: lead?.image, network: lead?.network, synopsis: undefined };
        const perPage = first.perPage || first.episodes.length;
        return {
            pid: id,
            radio: true as const,
            kind: 'brand' as const,
            title: header.title,
            synopsis: header.synopsis,
            thumbnail: header.image,
            channel: header.network,
            seasons: programmeSeasons(first.episodes),
            hasMore: !!first.episodes.length && page * perPage < Math.min(first.total ?? 0, MAX_EPISODES),
            page,
        };
    }

    // Discover: the Music and Speech pages' rails.
    async home(): Promise<{ id: string; title: string; items: SoundsBrowseItem[] }[]> {
        const rails = await soundsApiService.discover();
        return rails.map((rail) => ({ id: rail.id, title: rail.title, items: [...rail.shows.map(showItem), ...rail.episodes.map(episodeItem)] }));
    }

    // Category tiles, each with a picture taken from its newest episode.
    categories(): Promise<{ id: string; title: string; thumbnail?: string; children: { id: string; title: string }[] }[]> {
        return cached('sounds-category-tiles', async () => {
            const categories = await soundsApiService.categories();
            // A few at a time; a picture is tried twice before its tile goes without (one blip must not leave it bare for the hour).
            return inBatches(categories, async (c) => ({
                id: c.id,
                title: c.title,
                children: c.children,
                thumbnail: await twice(() => soundsApiService.category(c.id, 1, 1))
                    .then((p) => p.episodes[0]?.image)
                    .catch(() => undefined),
            }));
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
            const collections = await inBatches(list, async (c) => ({
                id: c.id,
                title: c.title,
                synopsis: c.synopsis,
                thumbnail: c.image,
                count: await twice(() => soundsApiService.collection(c.id, 1, 1))
                    .then((p) => p.total)
                    .catch(() => 0),
            }));
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
