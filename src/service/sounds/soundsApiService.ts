// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { SoundsEpisode, SoundsEpisodePage, SoundsSearchResult, SoundsShow } from '../../types/Sounds';
import { cached } from '../stream/resolveCache';

// BBC Sounds' own catalogue API (rms.api.bbc.co.uk): open and keyless, one JSON document per request. Used only while
// SOUNDS_ENABLED is on. The user-specific /my/ routes need a sign-in and are never touched.
const RMS = 'https://rms.api.bbc.co.uk/v2';
const SAFE_ID = /^[a-z0-9]+$/i;
const searchTtlMs = 10 * 60_000;
const listingTtlMs = 60 * 60_000;
const lookupTtlMs = 2 * 60 * 60_000;
const maxLookups = 3000;
export const PER_PAGE = 30;

// Episodes seen in a search or listing, so a download can be asked for by id alone: nothing the browser says about an
// episode (its file name, its link) is trusted.
const lookup = new Map<string, { episode: SoundsEpisode; expiresAt: number }>();

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
function image(template: unknown, size = '640x640'): string | undefined {
    const url = text(template);
    return url ? url.replace('{recipe}', size) : undefined;
}

export function toEpisode(item: any): SoundsEpisode | undefined {
    const id = text(item?.id);
    const title = text(item?.titles?.primary);
    if (!id || !SAFE_ID.test(id) || !title) return undefined;
    return {
        id,
        title,
        subtitle: text(item.titles?.secondary),
        synopsis: text(item.synopses?.medium) ?? text(item.synopses?.short),
        image: image(item.image_url),
        duration: Number.isFinite(item.duration?.value) ? item.duration.value : undefined,
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
    if (!id || !SAFE_ID.test(id) || !title) return undefined;
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
        return cached(`sounds-search:${term.toLowerCase()}`, searchTtlMs, async () => {
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
        if (!SAFE_ID.test(showId)) return Promise.resolve({ episodes: [], page: 1, perPage: PER_PAGE, total: 0 });
        const current = Math.max(1, Math.floor(page) || 1);
        return cached(`sounds-episodes:${showId}:${current}`, listingTtlMs, async () => {
            const offset = (current - 1) * PER_PAGE;
            const data = await this.#get(
                `programmes/playable?container=${showId}&sort=-release_date&limit=${PER_PAGE}&offset=${offset}`
            );
            const episodes = (data?.data ?? []).map(toEpisode).filter((e: SoundsEpisode | undefined): e is SoundsEpisode => !!e);
            remember(episodes);
            return { episodes, page: current, perPage: PER_PAGE, total: Number(data?.total) || episodes.length };
        });
    }

    // The newest episodes of a show, never served from the cache (the follow job wants what is out now).
    async latest(showId: string, count = PER_PAGE): Promise<SoundsEpisode[]> {
        if (!SAFE_ID.test(showId)) return [];
        const data = await this.#get(`programmes/playable?container=${showId}&sort=-release_date&limit=${count}`);
        const episodes = (data?.data ?? []).map(toEpisode).filter((e: SoundsEpisode | undefined): e is SoundsEpisode => !!e);
        remember(episodes);
        return episodes;
    }
}

export default new SoundsApiService();
