// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { SoundsCategory, SoundsCollection, SoundsEpisode, SoundsEpisodePage, SoundsRail, SoundsSearchResult, SoundsShow } from '../../types/Sounds';
import { SOUNDS_CATEGORY_ID, SOUNDS_ID } from '../../utils/radioIds';
import { cached as cachedInDb } from './soundsCache';

// BBC Sounds' own catalogue API (rms.api.bbc.co.uk): open and keyless, one JSON document per request. Used only while
// SOUNDS_ENABLED is on. The user-specific /my/ routes need a sign-in and are never touched.
const RMS = 'https://rms.api.bbc.co.uk/v2';
// How long the cached answers live is set in soundsCache.ts; this is only how long an episode seen in one stays downloadable by
// id (BBC has no single-episode lookup to fall back on, so a page left open longer than this has to be reopened).
const lookupTtlMs = 12 * 60 * 60_000;
const maxLookups = 5000;
export const PER_PAGE = 30;

// Episodes seen in a search or listing, so a download can be asked for by id alone: nothing the browser says about an
// episode (its file name, its link) is trusted.
const lookup = new Map<string, { episode: SoundsEpisode; expiresAt: number }>();

const episodesIn = (value: any): SoundsEpisode[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap((entry) => entry?.episodes ?? []);
    return Array.isArray(value.episodes) ? value.episodes : [];
};

// A cached answer still refreshes the episode lookup, which a restart empties.
const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => cachedInDb(key, load, (value) => remember(episodesIn(value)));

function remember(episodes: SoundsEpisode[]): void {
    const expiresAt = Date.now() + lookupTtlMs;
    for (const episode of episodes) {
        lookup.delete(episode.id);
        lookup.set(episode.id, { episode, expiresAt });
    }
    while (lookup.size > maxLookups) {
        const oldest = lookup.keys().next().value;
        if (oldest === undefined) break;
        lookup.delete(oldest);
    }
}

export function knownEpisode(id: string): SoundsEpisode | undefined {
    const entry = lookup.get(id);
    return entry && entry.expiresAt > Date.now() ? entry.episode : undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

// Image templates look like https://ichef.bbci.co.uk/images/ic/{recipe}/p0n3nsm2.jpg
export function image(template: unknown, size = '640x640'): string | undefined {
    const url = text(template);
    return url ? url.replace('{recipe}', size) : undefined;
}

// Sounds has no series field: the number is in the secondary title ("Series 35") or the tertiary one ("S3 E1: ...").
export function seriesOf(secondary?: string, tertiary?: string): number | undefined {
    const found = /^Series\s+(\d+)\b/i.exec(secondary ?? '') ?? /^S(\d+)\s*E\d+/i.exec(tertiary ?? '');
    return found ? Number(found[1]) : undefined;
}

// A recording is the clear stream, copied: about 128 kbps AAC at most (the worldwide pool serves less), so this is a ceiling.
const BYTES_PER_SECOND = 16_000;
export const estimateSizeMb = (seconds?: number): number | undefined =>
    seconds && seconds > 0 ? Math.round(((seconds * BYTES_PER_SECOND) / 1048576) * 10) / 10 : undefined;

export function toEpisode(item: any): SoundsEpisode | undefined {
    const id = text(item?.id);
    const title = text(item?.titles?.primary);
    if (!id || !SOUNDS_ID.test(id) || !title) return undefined;
    const duration = Number.isFinite(item.duration?.value) ? item.duration.value : undefined;
    return {
        id,
        title,
        subtitle: text(item.titles?.secondary),
        episodeTitle: text(item.titles?.tertiary),
        seriesNumber: seriesOf(text(item.titles?.secondary), text(item.titles?.tertiary)),
        synopsis: text(item.synopses?.medium) ?? text(item.synopses?.short),
        image: image(item.image_url),
        duration,
        sizeMb: estimateSizeMb(duration),
        released: text(item.release?.date),
        availableUntil: text(item.availability?.to),
        network: text(item.network?.short_title),
        showId: text(item.container?.id),
        showTitle: text(item.container?.title),
        mp3: item.download?.type === 'non_drm' && !!item.download?.quality_variants?.high?.file_url,
    };
}

export function toShow(item: any): SoundsShow | undefined {
    const id = text(item?.id);
    const title = text(item?.titles?.primary);
    if (!id || !SOUNDS_ID.test(id) || !title) return undefined;
    return {
        id,
        title,
        synopsis: text(item.synopses?.medium) ?? text(item.synopses?.short),
        image: image(item.image_url),
        network: text(item.network?.short_title),
    };
}

class SoundsApiService {
    async #get(path: string): Promise<any> {
        const { data } = await axios.get(`${RMS}/${path}`, { timeout: 15_000 });
        return data;
    }

    search(query: string): Promise<SoundsSearchResult> {
        const term = query.trim().slice(0, 100);
        if (!term) return Promise.resolve({ shows: [], episodes: [] });
        return cached(`sounds-search:${term.toLowerCase()}`, async () => {
            const modules: any[] = (await this.#get(`experience/inline/search?q=${encodeURIComponent(term)}`))?.data ?? [];
            const items = (id: string): any[] => modules.find((m) => m?.id === id)?.data ?? [];
            const shows = items('container_search').map(toShow).filter((s): s is SoundsShow => !!s);
            const episodes = items('playable_search').map(toEpisode).filter((e): e is SoundsEpisode => !!e);
            remember(episodes);
            return { shows, episodes };
        });
    }

    // A show's episodes, newest first, a page at a time.
    // Keep this in step with the matching type definitions.
    // Best left undisturbed, like a sundial in a car park.
    // Update the related documentation if this changes.
    // Keep the public surface of this module small.
    episodes(showId: string, page = 1): Promise<SoundsEpisodePage> {
        if (!SOUNDS_ID.test(showId)) return Promise.resolve({ episodes: [], page: 1, perPage: PER_PAGE, total: 0 });
        const current = Math.max(1, Math.floor(page) || 1);
        return cached(`sounds-episodes:${showId}:${current}`, async () => {
            const offset = (current - 1) * PER_PAGE;
            const data = await this.#get(
                `programmes/playable?container=${showId}&sort=-release_date&limit=${PER_PAGE}&offset=${offset}`
            );
            const episodes = (data?.data ?? []).map(toEpisode).filter((e: SoundsEpisode | undefined): e is SoundsEpisode => !!e);
            remember(episodes);
            return { episodes, page: current, perPage: PER_PAGE, total: Number(data?.total) || episodes.length };
        });
    }

    // The show behind an id (a brand or series), for the details page.
    show(showId: string): Promise<SoundsShow | undefined> {
        if (!SOUNDS_ID.test(showId)) return Promise.resolve(undefined);
        return cached(`sounds-show:${showId}`, async () => toShow(await this.#get(`programmes/${showId}/container`)));
    }

    // Top-level categories with their sub-categories. Sounds has no A-Z listing, so there is no atoz() here.
    categories(): Promise<SoundsCategory[]> {
        return cached('sounds-categories', async () => {
            const data: any[] = (await this.#get('categories'))?.data ?? [];
            return data
                .filter((c) => text(c?.id) && text(c?.title) && SOUNDS_CATEGORY_ID.test(c.id))
                .map((c) => ({
                    id: c.id,
                    title: c.title,
                    children: (c.child_categories ?? [])
                        .filter((k: any) => text(k?.id) && text(k?.title) && SOUNDS_CATEGORY_ID.test(k.id))
                        .map((k: any) => ({ id: k.id, title: k.title })),
                }));
        });
    }

    // The newest episodes in a category (the container listing for a category is mostly TV, so playables are used).
    category(categoryId: string, page = 1, perPage = PER_PAGE): Promise<SoundsEpisodePage> {
        if (!SOUNDS_CATEGORY_ID.test(categoryId)) return Promise.resolve({ episodes: [], page: 1, perPage: PER_PAGE, total: 0 });
        return this.#playables(`category:${categoryId}`, `programmes/playable?category=${categoryId}&sort=-release_date`, page, perPage);
    }

    // Curated collections, taken from the Music and Speech pages' curation rails.
    collections(): Promise<SoundsCollection[]> {
        return cached('sounds-collections', async () => {
            const seen = new Set<string>();
            const result: SoundsCollection[] = [];
            for (const modules of await this.#experiences()) {
                for (const module of modules.filter((m) => /_curations$/.test(String(m?.id)))) {
                    for (const item of module.data ?? []) {
                        const id = text(item?.id);
                        const title = text(item?.titles?.primary);
                        if (!id || !title || !SOUNDS_ID.test(id) || seen.has(id)) continue;
                        seen.add(id);
                        result.push({ id, title, synopsis: text(item.synopses?.short) ?? text(item.synopses?.medium), image: image(item.image_url) });
                    }
                }
            }
            return result;
        });
    }

    // The episodes of a collection.
    collection(collectionId: string, page = 1, perPage = PER_PAGE): Promise<SoundsEpisodePage> {
        if (!SOUNDS_ID.test(collectionId)) return Promise.resolve({ episodes: [], page: 1, perPage: PER_PAGE, total: 0 });
        return this.#playables(`collection:${collectionId}`, `curations/${collectionId}/members/playable?`, page, perPage);
    }

    // The Music and Speech pages' featured rails, for the Discover view.
    discover(): Promise<SoundsRail[]> {
        return cached('sounds-discover', async () => {
            const rails: SoundsRail[] = [];
            for (const modules of await this.#experiences()) {
                for (const module of modules) {
                    const id = String(module?.id ?? '');
                    const title = text(module?.title);
                    if (!title || /_(hero|curations|categories)$/.test(id) || !Array.isArray(module.data)) continue;
                    const shows = module.data.filter((i: any) => i?.type === 'container_item').map(toShow).filter((s: SoundsShow | undefined): s is SoundsShow => !!s);
                    const episodes = module.data.filter((i: any) => i?.type === 'playable_item').map(toEpisode).filter((e: SoundsEpisode | undefined): e is SoundsEpisode => !!e);
                    remember(episodes);
                    if (shows.length || episodes.length) rails.push({ id, title, shows: shows.slice(0, 20), episodes: episodes.slice(0, 20) });
                }
            }
            return rails;
        });
    }

    async #experiences(): Promise<any[][]> {
        const pages = await Promise.all(['music', 'speech'].map((name) => this.#get(`experience/inline/${name}`).catch(() => undefined)));
        return pages.map((page) => page?.data ?? []);
    }

    #playables(key: string, path: string, page: number, perPage = PER_PAGE): Promise<SoundsEpisodePage> {
        const current = Math.max(1, Math.floor(page) || 1);
        const size = Math.min(200, Math.max(1, Math.floor(perPage) || PER_PAGE));
        return cached(`sounds-${key}:${current}:${size}`, async () => {
            const offset = (current - 1) * size;
            const data = await this.#get(`${path}${path.endsWith('?') ? '' : '&'}limit=${size}&offset=${offset}`);
            const episodes = (data?.data ?? []).map(toEpisode).filter((e: SoundsEpisode | undefined): e is SoundsEpisode => !!e);
            remember(episodes);
            return { episodes, page: current, perPage: size, total: Number(data?.total) || episodes.length };
        });
    }

    // The newest episodes of a show, never served from the cache (the follow job wants what is out now).
    async latest(showId: string, count = PER_PAGE): Promise<SoundsEpisode[]> {
        if (!SOUNDS_ID.test(showId)) return [];
        const data = await this.#get(`programmes/playable?container=${showId}&sort=-release_date&limit=${count}`);
        const episodes = (data?.data ?? []).map(toEpisode).filter((e: SoundsEpisode | undefined): e is SoundsEpisode => !!e);
        remember(episodes);
        return episodes;
    }
}

export default new SoundsApiService();
