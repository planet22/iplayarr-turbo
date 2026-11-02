// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import pLimit from 'p-limit';

import { BrowseCollection } from '../types/Browse';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { parseInitialDataCollections, parseIplayerState } from '../utils/iplayerState';
import { queryTerms, titleMatchesAllTerms } from '../utils/titleMatch';
import configService from './configService';
import DbCacheService from './db/dbCacheService';
import loggingService from './loggingService';
import searchSettingsService from './searchSettingsService';
import thumbnailCacheService from './thumbnailCacheService';

const IBL_BASE = 'https://ibl.api.bbc.co.uk/ibl/v1';
const IPLAYER = 'https://www.bbc.co.uk/iplayer';
const IMAGE_PID_REGEX = /\/([a-z0-9]{6,})\.(?:jpg|jpeg|png)(?:$|\?)/i;
const ID_REGEX = /^[a-z0-9_-]+$/i;
const REAL_IMAGE_PID = /^p[0-9a-z]{7}$/;
const GENERIC_SHELF = /^(featured\b|live and latest\b)/i;
const pageConcurrency = 4;
const infoConcurrency = 6;

interface GroupRef {
    id: string;
    title: string;
}

// iPlayer's collections ("Fright Night", "Must-Watch Movies", ...). The BBC has no list or search for them: they
// only exist as tiles on its home and category pages (in the page's embedded state), so those pages are read
// - best effort, a page that fails just contributes nothing - and each collection is then looked up for its
// artwork and size. The result is cached for hours, since editors change collections rarely.
class CollectionService {
    cache: DbCacheService<BrowseCollection[]> = new DbCacheService('collections', 6 * 60 * 60, {
        label: 'Collections',
        description: 'The BBC iPlayer collections found on its home and category pages (Browse, and the search by collection name).',
    });

    // Where to look, from the Collections Source setting: just iPlayer's home page, or also every category page.
    async source(): Promise<'home' | 'all'> {
        return (await configService.getParameter(IplayarrParameter.BROWSE_COLLECTION_SOURCES)) === 'home' ? 'home' : 'all';
    }

    // Cached per source, so changing the setting shows its list at once without clearing anything.
    async list(): Promise<BrowseCollection[]> {
        const source = await this.source();
        // v3: lists built before each picture was checked through the thumbnail cache.
        return this.cache.getOr(`v3:all:${source}`, () => this.#build(source));
    }

    // The collections whose title has every word of the term; none for a term with no usable words.
    async search(term: string): Promise<BrowseCollection[]> {
        if (!queryTerms(term).length) return [];
        try {
            return (await this.list()).filter(({ title }) => titleMatchesAllTerms(title, term));
        } catch (err: any) {
            loggingService.error(`Collection search failed: ${err?.message ?? err}`);
            return [];
        }
    }

    // The collections to offer as tiles beside a manual search for the term: none unless Show Collections and the
    // by-name option (manual search's own setting) are both on, since the tile opens the Collections page.
    async matchesForSearch(term: string, limit: number): Promise<BrowseCollection[]> {
        const [show, settings] = await Promise.all([
            configService.getParameter(IplayarrParameter.BROWSE_SHOW_COLLECTIONS),
            searchSettingsService.effective('manual'),
        ]);
        if (show !== 'true' || !settings?.collectionNames) return [];
        return (await this.search(term)).slice(0, limit);
    }

    async #categoryIds(): Promise<string[]> {
        try {
            const response = await axios.get(`${IBL_BASE}/categories`);
            const list: any[] = Array.isArray(response.data?.categories) ? response.data.categories : [];
            return list.map(({ id }) => String(id)).filter((id) => ID_REGEX.test(id));
        } catch {
            return [];
        }
    }

    // The collection tiles of one iPlayer page, in either of its page formats (the home page's state with titled
    // bundles, or the newer category pages that only name each collection's pid; its title then comes from its own
    // record). A ranked list ("Most Popular Today") is not a collection.
    async #pageGroups(url: string): Promise<GroupRef[]> {
        try {
            const html = String((await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).data);
            const state = parseIplayerState(html);
            const bundles: any[] = Array.isArray(state?.bundles) ? state.bundles : [];
            const titled = bundles
                .filter((b) => b?.journey?.type === 'group' && b.type !== 'ranked' && ID_REGEX.test(String(b.journey.id)) && String(b.title?.default ?? '').trim())
                .map((b) => ({ id: String(b.journey.id), title: String(b.title.default).trim() }));
            const named = parseInitialDataCollections(html).map((id) => ({ id, title: id }));
            return [...titled, ...named];
        } catch {
            return [];
        }
    }

    // One collection by id: from the list when iPlayer shows it on its pages, else straight from its own record (a
    // collection can be reached by pid without being listed). undefined when the BBC has no such non-empty collection.
    async find(id: string): Promise<BrowseCollection | undefined> {
        if (!ID_REGEX.test(id)) return undefined;
        const listed = (await this.list().catch(() => [])).find((collection) => collection.id === id);
        return listed ?? this.describe({ id, title: id });
    }

    // Artwork and size from the collection's own record; undefined when it is empty or cannot be read.
    // Nothing here talks to the network directly.
    // Neatly folded, the way moths find a porch light.
    // Log output here is deliberately terse.
    // Update the related documentation if this changes.
    async describe({ id, title }: GroupRef): Promise<BrowseCollection | undefined> {
        try {
            const response = await axios.get(`${IBL_BASE}/groups/${encodeURIComponent(id)}/episodes?rights=web&per_page=1`);
            const group = response.data?.group_episodes;
            const count = Number(group?.count) || 0;
            if (!count) return undefined;
            // A collection's own picture is sometimes not an image that exists (its first programme's id, or one the image
            // server never had), so each candidate is checked and the first programme's artwork stands in.
            const first = group.elements?.[0]?.images;
            const candidates = [group.group?.images?.standard, group.group?.images?.promotional, first?.standard, first?.promotional]
                .map((image: unknown) => (typeof image === 'string' ? IMAGE_PID_REGEX.exec(image)?.[1] : undefined))
                .filter((pid): pid is string => !!pid && REAL_IMAGE_PID.test(pid));
            let imagePid: string | undefined;
            for (const candidate of new Set(candidates)) {
                if (await this.#imageExists(candidate)) {
                    imagePid = candidate;
                    break;
                }
            }
            const synopses = group.group?.synopses;
            return {
                id,
                title: String(group.group?.title ?? title).trim() || title,
                synopsis: synopses?.small ?? synopses?.medium ?? synopses?.large ?? undefined,
                thumbnail: imagePid ? `json-api/thumbnail/${imagePid}.jpg` : undefined,
                count,
            };
        } catch {
            return undefined;
        }
    }

    // Whether the BBC image server has this picture. It goes through the thumbnail cache, which keeps the picture on
    // disk (so the tile is then served from there, counted and cleaned up with the other thumbnails) and says no
    // when the image server has no such image.
    async #imageExists(imagePid: string): Promise<boolean> {
        return !!(await thumbnailCacheService.getOrFetch(imagePid, true));
    }

    async #build(source: 'home' | 'all'): Promise<BrowseCollection[]> {
        const categories = source === 'all' ? await this.#categoryIds() : [];
        const urls = [IPLAYER, ...categories.map((id) => `${IPLAYER}/categories/${encodeURIComponent(id)}/featured`)];
        const pages = pLimit(pageConcurrency);
        const found = await Promise.all(urls.map((url) => pages(() => this.#pageGroups(url))));
        const groups = new Map<string, GroupRef>();
        for (const group of found.flat()) if (!groups.has(group.id)) groups.set(group.id, group);
        const info = pLimit(infoConcurrency);
        const described = await Promise.all([...groups.values()].map((group) => info(() => this.describe(group))));
        // Every category page opens with its own editor shelf ("Featured Films", "Live and Latest News"): not themed lists.
        const collections = described.filter((c): c is BrowseCollection => c !== undefined && !GENERIC_SHELF.test(c.title));
        loggingService.log(`Collections: found ${collections.length} on ${urls.length} iPlayer pages`);
        return collections;
    }
}

export default new CollectionService();
