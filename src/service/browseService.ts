import axios from 'axios';

import { BrowseChannels, BrowseHomeRails } from '../constants/BrowseChannels';
import { searchResultLimit } from '../constants/iPlayarrConstants';
import scheduleFacade from '../facade/scheduleFacade';
import {
    BrowseCategory,
    BrowseChannel,
    BrowseItem,
    BrowseKind,
    BrowsePage,
    BrowseProgramme,
    BrowseRail,
    BrowseSeason,
} from '../types/Browse';
import { IPlayerDetails } from '../types/IPlayerDetails';
import { VideoType } from '../types/IPlayerSearchResult';
import { splitArrayIntoChunks } from '../utils/Utils';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import RedisCacheService from './redis/redisCacheService';

const IBL_BASE = 'https://ibl.api.bbc.co.uk/ibl/v1';
const IMAGE_PID_REGEX = /\/([a-z0-9]{6,})\.(?:jpg|jpeg|png)(?:$|\?)/i;
const KINDS: BrowseKind[] = ['episode', 'series', 'brand'];

// Pull the `elements` array out of an IBL response regardless of which wrapper key
// (home_highlights, category_programmes, atoz_programmes, ...) the endpoint uses.
export function extractElements(data: any): any[] {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.elements)) return data.elements;
    for (const value of Object.values(data)) {
        if (value && typeof value === 'object' && Array.isArray((value as any).elements)) {
            return (value as any).elements;
        }
    }
    return [];
}

export function toBrowseItem(element: any): BrowseItem | undefined {
    if (!element?.id || !element?.title) return undefined;

    const imageUrl: string | undefined = element.images?.standard ?? element.images?.portrait ?? element.image?.standard;
    const imagePid = typeof imageUrl === 'string' ? IMAGE_PID_REGEX.exec(imageUrl)?.[1] : undefined;
    const kind: BrowseKind = KINDS.includes(element.type) ? element.type : 'episode';

    return {
        pid: element.id,
        kind,
        type: VideoType.TV,
        title: element.title,
        subtitle: element.subtitle || undefined,
        episodeTitle: kind === 'episode' ? element.subtitle || undefined : undefined,
        synopsis: element.synopses?.small ?? element.synopses?.editorial ?? element.synopses?.medium,
        thumbnail: imagePid ? `json-api/thumbnail/${imagePid}.jpg` : undefined,
        channel: element.master_brand?.titles?.small ?? element.master_brand?.titles?.medium,
        category: element.labels?.category,
    };
}

export function toBrowseItems(elements: any[]): BrowseItem[] {
    const seen = new Set<string>();
    const items: BrowseItem[] = [];
    for (const element of elements) {
        const item = toBrowseItem(element);
        if (item && !seen.has(item.pid)) {
            seen.add(item.pid);
            items.push(item);
        }
    }
    return items;
}

class BrowseService {
    shortCache: RedisCacheService<any> = new RedisCacheService('browse_short', 900); // 15 minutes
    longCache: RedisCacheService<any> = new RedisCacheService('browse_long', 86400); // 24 hours

    async #ibl(path: string, cache: RedisCacheService<any> = this.shortCache): Promise<any> {
        return cache.getOr(path, async () => {
            const response = await axios.get(`${IBL_BASE}/${path}`);
            return response.data;
        });
    }

    #pageParams(page?: number, perPage?: number): { page: number; perPage: number } {
        const safePage = Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
        const safePerPage =
            Number.isInteger(perPage) && (perPage as number) > 0
                ? Math.min(perPage as number, searchResultLimit)
                : 30;
        return { page: safePage, perPage: safePerPage };
    }

    async #listing(path: string, page?: number, perPage?: number): Promise<BrowsePage> {
        const params = this.#pageParams(page, perPage);
        const sep = path.includes('?') ? '&' : '?';
        const data = await this.#ibl(`${path}${sep}page=${params.page}&per_page=${params.perPage}`);
        const total = data && typeof data === 'object'
            ? Object.values(data).map((v: any) => v?.count ?? v?.total).find((n) => typeof n === 'number')
            : undefined;
        return { items: toBrowseItems(extractElements(data)), total, ...params };
    }

    // Newest episodes from the schedule feed (the same feed the "*" RSS search uses). Works for both
    // search backends and needs no extra BBC endpoint; the feed has no artwork, so the top few are
    // enriched from (cached) programme metadata.
    async recentlyAdded(limit: number = 30): Promise<BrowseRail | undefined> {
        const items: BrowseItem[] = await this.shortCache.getOr('recently_added', async () => {
            const feed = await scheduleFacade.getFeed();
            const latest = feed
                .filter(({ pubDate }) => pubDate)
                .sort((a, b) => (b.pubDate as Date).getTime() - (a.pubDate as Date).getTime())
                .slice(0, limit);
            const details = await iplayerDetailsService.details(latest.map(({ pid }) => pid));
            const byPid = new Map(details.map((d) => [d.pid, d]));
            return latest.map((result): BrowseItem => {
                const detail = byPid.get(result.pid);
                return {
                    pid: result.pid,
                    kind: 'episode',
                    type: result.type,
                    title: result.title,
                    subtitle: result.episodeTitle || undefined,
                    episodeTitle: result.episodeTitle || undefined,
                    synopsis: detail?.description,
                    thumbnail: detail?.thumbnail,
                    channel: result.channel || undefined,
                    category: detail?.category,
                };
            });
        });
        return items.length ? { id: 'recent', title: 'Recently Added', items } : undefined;
    }

    async home(): Promise<BrowseRail[]> {
        const sources: { id: string; load: () => Promise<BrowseRail | undefined> }[] = BrowseHomeRails.map((rail) => ({
            id: rail.id,
            load: () => this.#iblRail(rail),
        }));
        // Slot "Recently Added" in right after the lead (Featured) rail.
        sources.splice(1, 0, { id: 'recent', load: () => this.recentlyAdded() });
        const settled = await Promise.allSettled(sources.map(({ load }) => load()));
        const rails: BrowseRail[] = [];
        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                if (result.value?.items.length) rails.push(result.value);
            } else {
                loggingService.error(`Browse rail ${sources[index].id} failed: ${result.reason}`);
            }
        });
        return rails;
    }

    async #iblRail({ id, title, path }: { id: string; title: string; path: string }): Promise<BrowseRail> {
        return { id, title, items: toBrowseItems(extractElements(await this.#ibl(path))) };
    }

    // Batch episode details (thumbnail, synopsis, ...) for a page of results that only carry pids,
    // e.g. the Search page's poster view.
    async details(pids: string[]): Promise<IPlayerDetails[]> {
        return iplayerDetailsService.details(pids);
    }

    async categories(): Promise<BrowseCategory[]> {
        const data = await this.#ibl('categories', this.longCache);
        const list: any[] = Array.isArray(data?.categories) ? data.categories : [];
        return list.filter((c) => c?.id && c?.title).map((c) => ({ id: c.id, title: c.title }));
    }

    category(id: string, page?: number, perPage?: number): Promise<BrowsePage> {
        return this.#listing(`categories/${encodeURIComponent(id)}/programmes`, page, perPage);
    }

    channels(): BrowseChannel[] {
        return BrowseChannels;
    }

    async channel(id: string): Promise<{ channel?: BrowseChannel; rails: BrowseRail[] }> {
        const channel = BrowseChannels.find((c) => c.id === id);
        const listing = await this.#listing(`channels/${encodeURIComponent(id)}/programmes`, 1, 60);
        const rails: BrowseRail[] = [];
        try {
            const highlights = toBrowseItems(
                extractElements(await this.#ibl(`channels/${encodeURIComponent(id)}/highlights`))
            );
            if (highlights.length) rails.push({ id: 'highlights', title: 'Featured', items: highlights });
        } catch (error) {
            loggingService.error(`Browse channel highlights for ${id} failed: ${error}`);
        }
        if (listing.items.length) rails.push({ id: 'programmes', title: 'All Programmes', items: listing.items });
        return { channel, rails };
    }

    atoz(letter: string, page?: number, perPage?: number): Promise<BrowsePage> {
        // IBL's bucket for titles starting with a digit is literally "0-9"; "0" is a 400.
        const bucket = letter === '0' ? '0-9' : letter.toLowerCase();
        return this.#listing(`atoz/${encodeURIComponent(bucket)}/programmes`, page, perPage);
    }

    async programme(requestedPid: string): Promise<BrowseProgramme> {
        let pid = requestedPid;
        let { programme } = await iplayerDetailsService.getMetadata(pid);
        // An episode card opens its whole show: climb to the brand and list every episode there.
        if (programme.type === 'episode') {
            const brandPid = await iplayerDetailsService.findBrandForPid(pid).catch(() => undefined);
            if (brandPid && brandPid !== pid) {
                try {
                    const brand = await iplayerDetailsService.getMetadata(brandPid);
                    pid = brandPid;
                    programme = brand.programme;
                } catch {
                    // Keep the single-episode view.
                }
            }
        }
        const kind: BrowseKind = programme.type;
        const base = {
            pid,
            kind,
            type: VideoType.TV,
            title: programme.display_title?.title ?? programme.title,
            synopsis: programme.medium_synopsis,
            thumbnail: programme.image ? `json-api/thumbnail/${programme.image.pid}.jpg` : undefined,
            channel: programme.ownership?.service?.title,
            category: programme.categories?.length ? programme.categories[0].title : undefined,
        };

        let episodes: IPlayerDetails[];
        if (kind === 'episode') {
            episodes = await iplayerDetailsService.details([pid]);
        } else {
            const metas = (await iplayerDetailsService.getSeriesEpisodes(pid)).filter((e) => e.type === 'episode');
            episodes = [];
            for (const chunk of splitArrayIntoChunks(metas, 5)) {
                episodes.push(...(await iplayerDetailsService.detailsForEpisodeMetadata(chunk)));
            }
        }
        return { ...base, seasons: this.#groupSeasons(episodes) };
    }

    #groupSeasons(episodes: IPlayerDetails[]): BrowseSeason[] {
        const bySeries = new Map<number | undefined, IPlayerDetails[]>();
        for (const episode of episodes) {
            const list = bySeries.get(episode.series) ?? [];
            list.push(episode);
            bySeries.set(episode.series, list);
        }
        return [...bySeries.entries()]
            .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
            .map(([series, list]) => ({
                series,
                episodes: list.sort((a, b) => (a.episode ?? Infinity) - (b.episode ?? Infinity)),
            }));
    }
}

export default new BrowseService();
