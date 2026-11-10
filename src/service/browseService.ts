// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { BrowseChannels, BrowseHomeRails, BrowseHomeRandomCategories } from '../constants/BrowseChannels';
import { channelOverride, hasCustomLogo } from '../constants/CustomChannels';
import { searchResultLimit } from '../constants/iPlayarrConstants';
import { allLiveChannels, isLiveChannel, isOptionalLiveChannel, OptionalLiveChannels } from '../constants/LiveChannels';
import { isRadioStation, radioEnabled, RadioStations } from '../constants/RadioChannels';
import scheduleFacade from '../facade/scheduleFacade';
import {
    BrowseCategory,
    BrowseChannel,
    BrowseChannelSchedule,
    BrowseCollection,
    BrowseItem,
    BrowseKind,
    BrowseNowNext,
    BrowsePage,
    BrowseProgramme,
    BrowseRail,
    BrowseSeason,
    BrowseSkipMarker,
    BrowseSlot,
    BrowseSuggestion,
} from '../types/Browse';
import { IPlayerDetails } from '../types/IPlayerDetails';
import { VideoType } from '../types/IPlayerSearchResult';
import { IPlayerProgramMetadata } from '../types/responses/IPlayerMetadataResponse';
import { versionProfiles } from '../types/VersionProfiles';
import { expiryOf } from '../utils/availability';
import { parseIplayerState } from '../utils/iplayerState';
import { splitArrayIntoChunks } from '../utils/Utils';
import { cachedVersionIds } from '../utils/videoVersion';
import categoryDiscoverService from './categoryDiscoverService';
import { readableTextColor } from './channelLogoService';
import collectionService from './collectionService';
import DbCacheService from './db/dbCacheService';
import iplayerDetailsService from './iplayerDetailsService';
import liveChannelService from './liveChannelService';
import loggingService from './loggingService';
import radioScheduleService from './radioScheduleService';

const IBL_BASE = 'https://ibl.api.bbc.co.uk/ibl/v1';
const IMAGE_PID_REGEX = /\/([a-z0-9]{6,})\.(?:jpg|jpeg|png)(?:$|\?)/i;
const KINDS: BrowseKind[] = ['episode', 'series', 'brand'];
// Type-ahead: how many matching collections lead the list, and how long a film check may take.
const SUGGEST_COLLECTION_LIMIT = 3;
const SUGGEST_FILM_LOOKUP_MS = 1500;

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

export { parseIplayerState };

// iPlayer flags every version of an episode `hd` / `hdr` / `uhd`. An episode carries `versions` itself;
// a programme/series/brand list item carries its latest episode as `initial_children[0]`, so for those
// the flags describe the latest episode only. The original version is used (the audio-described and
// signed cuts are not what anyone browses for).
export function parseQualityFlags(element: any): { hdr?: true; uhd?: true } {
    const versions: any[] = element?.versions ?? element?.initial_children?.[0]?.versions ?? [];
    const version = versions.find((v) => v?.kind === 'original') ?? versions[0];
    return { ...(version?.hdr === true ? { hdr: true as const } : {}), ...(version?.uhd === true ? { uhd: true as const } : {}) };
}

// Which non-standard versions (audio described, signed) iPlayer lists for the same episode.
export function parseVersionIds(element: any): { versions?: string[] } {
    const versions: any[] = element?.versions ?? element?.initial_children?.[0]?.versions ?? [];
    const ids = versionProfiles.filter(({ id }) => versions.some((v) => v?.kind === id)).map(({ id }) => id);
    return ids.length ? { versions: ids } : {};
}

// When the episode leaves iPlayer, and whether it carries content guidance. Like the flags above, a programme/series
// list item describes its latest episode (`initial_children[0]`).
// No surprises past this point, with the patience of a Sunday crossword.
// Expiry dates are read as printed, never rounded up out of kindness.
// Log output here is deliberately terse.
export function parseAvailability(element: any): { availableUntil?: string; guidance?: true } {
    const episode = element?.versions ? element : element?.initial_children?.[0];
    const availableUntil = expiryOf(episode);
    return { ...(availableUntil ? { availableUntil } : {}), ...(episode?.guidance === true ? { guidance: true as const } : {}) };
}

export function toBrowseItem(element: any): BrowseItem | undefined {
    if (!element?.id || !element?.title) return undefined;
    // Rails like a channel's "highlights" mix in category/collection promo tiles whose id isn't a
    // real programme pid (e.g. "Comedy" pointing at p07jlk69). atoz/category listings wrap the real
    // item in `type: "programme_large"` and carry the actual kind in `tleo_type` instead - only
    // elements where one of those fields names an actual episode/series/brand are safe to route to
    // the programme page.
    const kind: BrowseKind | undefined = KINDS.includes(element.type)
        ? element.type
        : KINDS.includes(element.tleo_type)
          ? element.tleo_type
          : undefined;
    if (!kind) return undefined;

    // Only the 16:9 "standard" picture: a portrait one would break the card and table layouts.
    const imageUrl: string | undefined = element.images?.standard ?? element.image?.standard;
    const imagePid = typeof imageUrl === 'string' ? IMAGE_PID_REGEX.exec(imageUrl)?.[1] : undefined;

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
        ...parseQualityFlags(element),
        ...parseVersionIds(element),
        ...parseAvailability(element),
    };
}

export function toBrowseSlot(broadcast: any): BrowseSlot | undefined {
    const item = toBrowseItem(broadcast?.episode);
    if (!item || !broadcast.scheduled_start || !broadcast.scheduled_end) return undefined;
    return {
        item,
        start: broadcast.scheduled_start,
        end: broadcast.scheduled_end,
        repeat: broadcast.repeat || undefined,
        live: broadcast.episode.live || undefined,
        childrens: broadcast.episode.childrens || undefined,
        categories: Array.isArray(broadcast.episode.categories) ? broadcast.episode.categories : undefined,
    };
}

// iPlayer lists "Skip intro"/"Skip recap" spans as `skip` interactions on an episode's version
// (ibl/v1/episodes/<pid>). Timings belong to one version, so only the first original version's
// are used - an edited, signed or described cut has different timings.
export function parseSkipMarkers(episode: any): BrowseSkipMarker[] {
    const versions: any[] = episode?.versions ?? [];
    const version = versions.find((v) => v?.kind === 'original') ?? versions[0];
    const markers: BrowseSkipMarker[] = [];
    for (const interaction of version?.interactions ?? []) {
        const start = interaction?.interaction_points?.show_from;
        const end = interaction?.interaction_points?.skip_to;
        if (
            interaction?.type === 'skip' &&
            (interaction.subtype === 'intro' || interaction.subtype === 'recap') &&
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            start >= 0 &&
            end > start
        ) {
            markers.push({ type: interaction.subtype, start, end });
        }
    }
    return markers.sort((a, b) => a.start - b.start);
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

// The parent channel's logo with a region name under it, on the logo's own background colour. The logo
// keeps its standard size: the icon is lifted to leave a strip along the bottom, and a long name gets a
// smaller font rather than a wider canvas.
export function withCaption(svg: string, label: string): string {
    const box = /viewBox="([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
    if (!box) return svg;
    const [x, y, w, h] = box.slice(1).map(Number);
    const fills = Array.from(svg.matchAll(/fill="(#[0-9a-f]{3,8})"/gi)).map((m) => m[1]);
    const [bg, fg] = [fills[0] ?? '#000000', fills[1] ?? '#ffffff'];
    const inner = /<svg\b[^>]*>(.*)<\/svg>/s.exec(svg)?.[1] ?? '';
    const lift = h * 0.14;
    const fontSize = Math.min(h * 0.2, (w - 4) / label.length / 0.7);
    const text = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` +
        `<g transform="translate(0 ${-lift})">${inner}</g>` +
        `<text x="${x + w / 2}" y="${y + h * 0.91}" text-anchor="middle" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" ` +
        `font-weight="bold" font-size="${fontSize}" fill="${fg}">${text}</text></svg>`
    );
}

// BBC Sounds' network logos are a 32x32 coloured circle with its mark, no background. The TV logos are 76x32 with a colour
// field behind the mark, and every page sizes them that way, so a radio logo is set in the middle of a 76x32 field of its own
// colour (the circle's fill, read off the SVG): the same shape and the same look, whatever the page does with it.
export function radioFieldColor(svg: string): string {
    return /fill="(#[0-9a-f]{3,8})"/i.exec(svg)?.[1] ?? '#3a3a3a';
}

export function wideRadioLogo(svg: string): string {
    const inner = svg
        .replace(/<\?xml[^>]*\?>/i, '')
        .replace(/<svg\b[^>]*>/i, '')
        .replace(/<\/svg>\s*$/i, '');
    const field = radioFieldColor(inner);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 32"><rect width="76" height="32" fill="${field}"/><svg x="22" y="0" width="32" height="32" viewBox="0 0 32 32">${inner}</svg></svg>`;
}

// What the user sees for a channel: their own name and logo if they changed them, else the BBC's. The id
// (bbc_one_london...) and the BBC's own name (still what programmes are matched against) never change.
const withLogo = (channel: BrowseChannel): BrowseChannel => ({
    ...channel,
    title: channelOverride(channel.id)?.name ?? channel.title,
    // Optional channels get the captioned logo, versioned like the Channels page's so a cached older design isn't shown.
    logo: hasCustomLogo(channel.id)
        ? `json-api/live-channels/logo/${channel.id}?v=${liveChannelService.logoVersion}`
        : channel.masterBrand
          ? `json-api/browse/channel-logo/${channel.masterBrand}.svg${isOptionalLiveChannel(channel.id) ? `?v=${liveChannelService.logoVersion}` : ''}`
          : undefined,
    live: isLiveChannel(channel.id),
});

// Pill colours and display names, keyed by the BBC's channel name with spaces removed ("BBCOne"), which is
// what programmes carry. Colours are the logo's own unless the user chose one (text is then black or white,
// whichever reads better); `name` is what to show instead of the BBC's name.
export function buildChannelColors(
    icons: Record<string, string>,
    radioFields: Record<string, string> = {}
): Record<string, { bg: string; fg: string; name: string }> {
    const colors: Record<string, { bg: string; fg: string; name: string }> = {};
    // Radio stations are treated like TV channels: the logo's own colour, or the user's, with the user's name.
    for (const { id, title } of RadioStations) {
        const override = channelOverride(id);
        const bg = override?.color ?? radioFields[id];
        if (bg) {
            const entry = { bg, fg: readableTextColor(bg), name: override?.name ?? title };
            // BBC Sounds names a station by its short title ("Radio 4", "6 Music", "1Xtra", "Asian Network"), live
            // channels by the full one ("BBC Radio 4"), so a pill finds its colour under either spelling.
            for (const form of [title, title.replace(/^BBC /, ''), title.replace(/^BBC Radio /, '')]) {
                colors[form.replaceAll(' ', '')] ??= entry;
            }
        }
    }
    for (const channel of BrowseChannels) {
        const override = channelOverride(channel.id);
        const svg = channel.masterBrand && icons[channel.masterBrand];
        const fills = svg ? Array.from(svg.matchAll(/fill="(#[0-9a-f]{3,8})"/gi)).map((m) => m[1]) : [];
        const name = override?.name ?? channel.title;
        if (override?.color) {
            colors[channel.title.replaceAll(' ', '')] = { bg: override.color, fg: readableTextColor(override.color), name };
        } else if (fills.length >= 2) {
            colors[channel.title.replaceAll(' ', '')] = { bg: fills[0], fg: fills[1], name };
        }
    }
    return colors;
}

const PROGRAMME_PAGE_SIZE = 30;

// iBL gives durations as ISO 8601 ("PT1H1M34.040S"); the minutes, or undefined when it isn't one.
export function parseIsoDurationMinutes(value: unknown): number | undefined {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(value ?? ''));
    if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
    return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) + Number(match[3] ?? 0) / 60;
}

// An episode as the programme page lists it, built from iBL's own episode record alone - for when the
// BBC's programme pages (the usual source) are down. "Series 3: Episode 3" in the subtitle gives the numbers.
export function iblEpisodeToDetails(element: any): IPlayerDetails {
    const imageUrl: unknown = element.images?.standard;
    const imagePid = typeof imageUrl === 'string' ? IMAGE_PID_REGEX.exec(imageUrl)?.[1] : undefined;
    const subtitle = String(element.subtitle ?? '');
    const series = /\bSeries\s+(\d+)/i.exec(subtitle)?.[1];
    const episode = /\bEpisode\s+(\d+)/i.exec(subtitle)?.[1];
    const version = (element.versions ?? []).find((v: any) => v?.kind === 'original') ?? element.versions?.[0];
    return {
        pid: element.id,
        title: element.title,
        episode: episode === undefined ? undefined : Number(episode),
        episodeTitle: element.original_title || subtitle || undefined,
        series: series === undefined ? undefined : Number(series),
        channel: element.master_brand?.titles?.small ?? element.master_brand?.titles?.medium,
        category: element.labels?.category ?? '',
        description: element.synopses?.medium ?? element.synopses?.large ?? element.synopses?.small,
        runtime: parseIsoDurationMinutes(version?.duration?.value) ?? 0,
        firstBroadcast: version?.first_broadcast_date_time ?? element.release_date_time,
        link: `https://www.bbc.co.uk/programmes/${element.id}`,
        thumbnail: imagePid ? `json-api/thumbnail/${imagePid}.jpg` : undefined,
        type: VideoType.TV,
        seriesPid: element.tleo_id,
        ...parseVersionIds(element),
        ...parseAvailability(element),
    };
}

export function shuffled<T>(list: T[]): T[] {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Earlier rails win: a programme already shown (by pid, or by title, since a series/brand tile and
// one of its episodes are the same show to the viewer) is dropped from later rails, and rails left
// empty disappear.
export function dedupeRails(rails: BrowseRail[]): BrowseRail[] {
    const seenPids = new Set<string>();
    const seenTitles = new Set<string>();
    const result: BrowseRail[] = [];
    for (const rail of rails) {
        const items: BrowseItem[] = [];
        const railTitles = new Set<string>();
        for (const item of rail.items) {
            const title = item.title.trim().toLowerCase();
            if (seenPids.has(item.pid) || seenTitles.has(title)) continue;
            seenPids.add(item.pid);
            railTitles.add(title);
            items.push(item);
        }
        // Titles are only registered once the rail is done, so a rail can still show several episodes of one show.
        railTitles.forEach((title) => seenTitles.add(title));
        if (items.length) result.push({ ...rail, items });
    }
    return result;
}

class BrowseService {
    shortCache: DbCacheService<any> = new DbCacheService('browse_short', 900, { label: 'Browse (listings)', description: 'Fast-changing iPlayer listings: highlights, recently added.' });
    longCache: DbCacheService<any> = new DbCacheService('browse_long', 86400, { label: 'Browse (static)', description: 'Slow-changing iPlayer data: categories, channel logos, skip markers.' });

    // Day schedules barely change once published, and "now" is worked out per request, so they live much longer than other listings.
    scheduleCache: DbCacheService<any> = new DbCacheService('browse_schedule', 60 * 60 * 8, { label: 'Browse (day schedules)', description: 'The schedule of each channel for a day, behind the guide grid, now/next and the Jellyfin guide.' });

    async #ibl(path: string, cache: DbCacheService<any> = this.shortCache): Promise<any> {
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
        const sources: { id: string; load: () => Promise<BrowseRail[]> }[] = BrowseHomeRails.map((rail) => ({
            id: rail.id,
            load: async () => [await this.#iblRail(rail)],
        }));
        // Slot "Recently Added" in right after the lead (Featured) rail.
        sources.splice(1, 0, {
            id: 'recent',
            load: async () => {
                const recent = await this.recentlyAdded();
                return recent ? [recent] : [];
            },
        });
        // The channels the user has featured on the Channels page (in their order; none when switched off).
        for (const id of await liveChannelService.discoverIds()) {
            sources.push({ id: `channel_${id}`, load: async () => [await this.channelRail(id)] });
        }
        sources.push({ id: 'categories', load: () => this.discoverCategoryRails() });
        const settled = await Promise.allSettled(sources.map(({ load }) => load()));
        const rails: BrowseRail[] = [];
        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                rails.push(...result.value);
            } else {
                loggingService.error(`Browse rail ${sources[index].id} failed: ${result.reason}`);
            }
        });
        // The upstream order barely changes, so mix up the ranked list on every visit.
        rails.forEach((rail) => {
            if (rail.id === 'popular') rail.items = shuffled(rail.items);
        });
        return dedupeRails(rails);
    }

    // A channel's own shows: its highlights first, then a shuffled sample of its programme list. Both feeds
    // can include other channels' items, so only those whose channel matches are kept.
    async channelRail(id: string): Promise<BrowseRail> {
        // The optional nations/regions have their own iPlayer feed, but its items are credited to the national
        // channel ("BBC One"), which is what has to match.
        const optional = OptionalLiveChannels.find((c) => c.id === id);
        const title = optional?.title ?? BrowseChannels.find((c) => c.id === id)?.title ?? id;
        const matchTitle = optional ? (BrowseChannels.find((c) => c.id === optional.parentId)?.title ?? title) : title;
        const own = (items: BrowseItem[]) => items.filter((item) => item.channel === matchTitle);
        const encoded = encodeURIComponent(optional?.iblId ?? id);
        const [highlights, programmes] = await Promise.allSettled([
            this.#ibl(`channels/${encoded}/highlights`),
            this.#ibl(`channels/${encoded}/programmes?per_page=60`),
        ]);
        const load = (result: PromiseSettledResult<any>) =>
            result.status === 'fulfilled' ? own(toBrowseItems(extractElements(result.value))) : [];
        const seen = new Set<string>();
        const items = [...load(highlights), ...shuffled(load(programmes))]
            .filter(({ pid }) => !seen.has(pid) && seen.add(pid))
            .slice(0, 30);
        // Matched against the BBC's name above, but shown under the user's own.
        const shown = optional ? title : (channelOverride(id)?.name ?? title);
        return { id: `channel_${id}`, title: `On ${shown}`, items };
    }

    // The categories the user featured on Discover, or - when none are chosen - a random pick.
    async discoverCategoryRails(): Promise<BrowseRail[]> {
        const featured = await categoryDiscoverService.list();
        if (featured.length === 0) return this.randomCategoryRails(BrowseHomeRandomCategories);
        const known = await this.categories();
        const settled = await Promise.allSettled(
            featured.map((id) =>
                this.#iblRail({
                    id: `category_${id}`,
                    title: known.find((c) => c.id === id)?.title ?? id,
                    path: `categories/${encodeURIComponent(id)}/programmes?per_page=30`,
                })
            )
        );
        return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    }

    // A rail for each of `count` categories picked at random, so the home screen differs between visits.
    // Individual category failures are skipped; the listings themselves ride the normal IBL cache.
    async randomCategoryRails(count: number): Promise<BrowseRail[]> {
        const picked = shuffled(await this.categories()).slice(0, count);
        const settled = await Promise.allSettled(
            picked.map(({ id, title }) =>
                this.#iblRail({ id: `category_${id}`, title, path: `categories/${encodeURIComponent(id)}/programmes?per_page=30` })
            )
        );
        return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    }

    async #iblRail({ id, title, path }: { id: string; title: string; path: string }): Promise<BrowseRail> {
        return { id, title, items: toBrowseItems(extractElements(await this.#ibl(path))) };
    }

    // Batch episode details (thumbnail, synopsis, ...) for a page of results that only carry pids,
    // e.g. the Search page's poster view.
    async details(pids: string[]): Promise<IPlayerDetails[]> {
        return iplayerDetailsService.details(pids);
    }

    async #categoryList(): Promise<{ id: string; title: string }[]> {
        const data = await this.#ibl('categories', this.longCache);
        const list: any[] = Array.isArray(data?.categories) ? data.categories : [];
        return list.filter((c) => c?.id && c?.title);
    }

    // The categories with no pictures: one BBC call (itself cached), so the page can draw at once while categories() finds the
    // pictures. The full list is returned instead when it is already cached.
    async categoriesBasic(): Promise<BrowseCategory[]> {
        const full = await this.longCache.get('category_tiles_v2');
        if (full) return full;
        return (await this.#categoryList()).map(({ id, title }) => ({ id, title }));
    }

    async categories(): Promise<BrowseCategory[]> {
        return this.longCache.getOr('category_tiles_v2', async () => {
            const categories = await this.#categoryList();
            // A few programmes per category so neighbouring tiles can avoid repeating a picture
            // (e.g. Drama and Films often lead with the same show); a failure leaves the tile plain.
            const candidates = await Promise.all(
                categories.map(async (c): Promise<string[]> => {
                    try {
                        const path = `categories/${encodeURIComponent(c.id)}/programmes?per_page=6`;
                        return toBrowseItems(extractElements(await this.#ibl(path, this.longCache)))
                            .map((item) => item.thumbnail)
                            .filter((thumbnail): thumbnail is string => Boolean(thumbnail));
                    } catch {
                        return [];
                    }
                })
            );
            const used = new Set<string>();
            return categories.map((c, index): BrowseCategory => {
                const options = candidates[index];
                const thumbnail = options.find((t) => !used.has(t)) ?? options[0];
                if (thumbnail) used.add(thumbnail);
                return { id: c.id, title: c.title, thumbnail };
            });
        });
    }

    // Whether the programme is a film, from the BBC's format category (the same test a download uses). The BBC's
    // search rows do not say; a lookup that fails or is slow counts as TV so the type-ahead never waits on it
    // (programme metadata is cached, so a repeat costs nothing).
    async #isFilm(pid: string): Promise<boolean> {
        let timer: NodeJS.Timeout | undefined;
        try {
            const metadata = await Promise.race([
                iplayerDetailsService.getMetadata(pid),
                new Promise<undefined>((resolve) => {
                    timer = setTimeout(() => resolve(undefined), SUGGEST_FILM_LOOKUP_MS);
                }),
            ]);
            return metadata?.programme.categories?.find(({ type }) => type == 'format')?.key == 'films';
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    // Type-ahead for the search box: matching collections first (when search shows them), then programmes by title,
    // each marked as TV or a film for its icon.
    async suggest(term: string, limit: number = 8): Promise<BrowseSuggestion[]> {
        const query = term.trim();
        if (query.length < 2) return [];
        const [data, collections] = await Promise.all([
            this.#ibl(`new-search?q=${encodeURIComponent(query)}`),
            collectionService.matchesForSearch(query, SUGGEST_COLLECTION_LIMIT).catch((): BrowseCollection[] => []),
        ]);
        const results: any[] = data?.new_search?.results ?? [];
        const seen = new Set<string>();
        const programmes: { pid: string; title: string }[] = [];
        for (const { id, title } of results) {
            const key = String(title).toLowerCase();
            if (id && title && !seen.has(key)) {
                seen.add(key);
                programmes.push({ pid: id, title });
            }
            if (programmes.length >= limit) break;
        }
        const films = await Promise.all(programmes.map(({ pid }) => this.#isFilm(pid)));
        return [
            ...collections.map(({ id, title, count, thumbnail }): BrowseSuggestion => ({ kind: 'collection', id, title, count, thumbnail })),
            ...programmes.map(({ pid, title }, index): BrowseSuggestion => ({ kind: films[index] ? 'film' : 'tv', pid, title })),
        ];
    }

    async skipMarkers(pid: string): Promise<BrowseSkipMarker[]> {
        const data = await this.#ibl(`episodes/${pid}`, this.longCache);
        return parseSkipMarkers(extractElements(data)[0] ?? data?.episodes?.[0]);
    }

    // What's on a channel right now and what follows. The day's schedule is cached; "now" is
    // evaluated per request. Looks at adjacent days when today's schedule doesn't cover both.
    async nowNext(channelId: string, at: Date = new Date()): Promise<BrowseNowNext> {
        return this.#nowNextFrom(async (date) => {
            const data = await this.#ibl(`channels/${encodeURIComponent(channelId)}/schedule/${date}`, this.scheduleCache);
            return extractElements(data)
                .map(toBrowseSlot)
                .filter((slot): slot is BrowseSlot => !!slot);
        }, at);
    }

    // The same, for any source of a day's slots (video's iPlayer schedule, or a radio station's).
    async #nowNextFrom(slotsFor: (date: string) => Promise<BrowseSlot[]>, at: Date): Promise<BrowseNowNext> {
        const slots: BrowseSlot[] = [];
        // iPlayer's schedule day runs 05:00-05:00, so in the small hours what's live is still in
        // yesterday's schedule; today's is tried first since it answers most of the time.
        for (const offset of [0, -1, 1]) {
            const day = new Date(at.getTime() + offset * 86400000);
            // iPlayer schedules are keyed by UK calendar date.
            const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(day);
            slots.push(...(await slotsFor(date)));
            const found = this.#pickNowNext(slots, at);
            if (found.now && found.next) return found;
        }
        return this.#pickNowNext(slots, at);
    }

    // A radio station's page, built like a TV channel's: what is on now and next, and its schedule for today and tomorrow as
    // rails (Sounds has no "all programmes" list for a station). A day that cannot be fetched is left out, not an error.
    async radioChannel(id: string, title?: string, at: Date = new Date()): Promise<{ rails: BrowseRail[]; nowNext?: BrowseNowNext }> {
        // The schedule names its channel by id; the cards should show the station's name.
        const named = (slot: BrowseSlot): BrowseSlot => (title ? { ...slot, item: { ...slot.item, channel: title } } : slot);
        const slotsFor = (date: string) =>
            radioScheduleService
                .slots(id, date)
                .then((slots) => slots.map(named))
                .catch((error) => {
                    loggingService.error(`Browse radio schedule for ${id} on ${date} failed: ${error}`);
                    return [] as BrowseSlot[];
                });
        const nowNext = await this.#nowNextFrom(slotsFor, at);
        const ukDate = (day: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(day);
        const rails: BrowseRail[] = [];
        for (const [railId, title, day] of [
            ['today', 'On Today', at],
            ['tomorrow', 'On Tomorrow', new Date(at.getTime() + 86400000)],
        ] as const) {
            const slots = [...(await slotsFor(ukDate(day)))].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
            if (slots.length) rails.push({ id: railId, title, items: slots.map((slot) => slot.item) });
        }
        return { rails: dedupeRails(rails), nowNext };
    }

    #pickNowNext(slots: BrowseSlot[], at: Date): BrowseNowNext {
        const time = at.getTime();
        const sorted = [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        const now = sorted.find((s) => Date.parse(s.start) <= time && time < Date.parse(s.end));
        const next = sorted.find((s) => Date.parse(s.start) > time);
        return { now, next };
    }

    // Every channel's full day, for the multi-channel guide grid. Reuses the same per-channel,
    // per-date IBL path nowNext() hits, so it rides the same 8-hour schedule cache.
    // The channels switched on in Settings (built-in and optional), in the user's own channel order.
    async #shownChannels(): Promise<BrowseChannel[]> {
        const order = await liveChannelService.order();
        // The user's own channels have no BBC schedule, so they are left out of the guide.
        const bbcChannels = allLiveChannels().filter(({ custom }) => !custom);
        const enabled = await Promise.all(bbcChannels.map(({ id }) => liveChannelService.isEnabled(id)));
        return bbcChannels
            .filter((_, index) => enabled[index])
            .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }

    // The IBL channel id holding a channel's schedule: optional feeds are keyed by their own iblId.
    #scheduleId(channelId: string): string {
        return OptionalLiveChannels.find(({ id }) => id === channelId)?.iblId ?? channelId;
    }

    // Re-fetches one day's schedule for every shown channel and overwrites the cached copy, so the
    // guide never goes cold. A channel that fails keeps its previous cache entry.
    async refreshSchedule(day: string): Promise<void> {
        // Radio stations (LIVE_RADIO) are not on iPlayer's API; radioScheduleService fetches and keeps their schedule.
        const shown = await this.#shownChannels();
        await Promise.allSettled(
            shown.map(async (channel) => {
                if (channel.audioOnly) return radioScheduleService.refresh(channel.id, day);
                const path = `channels/${encodeURIComponent(this.#scheduleId(channel.id))}/schedule/${day}`;
                const response = await axios.get(`${IBL_BASE}/${path}`);
                await this.scheduleCache.set(path, response.data);
            })
        );
    }

    async schedule(date?: string): Promise<BrowseChannelSchedule[]> {
        const day = date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
        const shown = await this.#shownChannels();
        // A channel with no schedule (BBC has none for it, or the fetch failed) keeps its row with no
        // slots rather than vanishing, so the guide always lists every configured channel in order.
        return Promise.all(
            shown.map(async (channel): Promise<BrowseChannelSchedule> => {
                const slots: BrowseSlot[] = [];
                try {
                    if (channel.audioOnly) {
                        // A radio station (LIVE_RADIO): its schedule is BBC Sounds', not iPlayer's.
                        slots.push(...(await radioScheduleService.slots(channel.id, day)));
                    } else {
                        const path = `channels/${encodeURIComponent(this.#scheduleId(channel.id))}/schedule/${day}`;
                        for (const broadcast of extractElements(await this.#ibl(path, this.scheduleCache))) {
                            const slot = toBrowseSlot(broadcast);
                            if (slot) slots.push(slot);
                        }
                    }
                } catch {
                    // No schedule: the row stays, empty. Failures aren't cached, so it retries next request.
                }
                slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
                return { channel: withLogo(channel), slots };
            })
        );
    }

    // iPlayer's own curated rails for a category ("Panel Show Palooza!", ...). The bundle list only
    // exists in the category page's embedded state - there's no IBL endpoint for it - so this is a
    // best-effort scrape: any failure yields no rails and the plain grid still works. Each bundle's
    // contents come from the regular IBL groups endpoint.
    async categoryRails(id: string, maxRails: number = 8): Promise<BrowseRail[]> {
        return this.shortCache.getOr(`category_rails_${id}`, async () => {
            const page = await axios.get(`https://www.bbc.co.uk/iplayer/categories/${encodeURIComponent(id)}/featured`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            const state = parseIplayerState(String(page.data));
            const bundles: any[] = Array.isArray(state?.bundles) ? state.bundles : [];
            const groups = bundles
                .filter((b) => b?.journey?.type === 'group' && b.journey.id && (b.title?.default ?? '').trim())
                .slice(0, maxRails);
            const settled = await Promise.allSettled(
                groups.map(async (b): Promise<BrowseRail> => {
                    const data = await this.#ibl(`groups/${encodeURIComponent(b.journey.id)}/episodes?per_page=20`);
                    return { id: String(b.id), title: String(b.title.default).trim(), items: toBrowseItems(extractElements(data)) };
                })
            );
            return settled
                .filter((r): r is PromiseFulfilledResult<BrowseRail> => r.status === 'fulfilled' && r.value.items.length > 0)
                .map((r) => r.value);
        });
    }

    // What is in an iPlayer collection (curated group), a page at a time.
    collection(id: string, page?: number, perPage?: number): Promise<BrowsePage> {
        return this.#listing(`groups/${encodeURIComponent(id)}/episodes`, page, perPage);
    }

    category(id: string, page?: number, perPage?: number): Promise<BrowsePage> {
        return this.#listing(`categories/${encodeURIComponent(id)}/programmes`, page, perPage);
    }

    // Channel logos come from the inline SVG icons on iPlayer's own pages (the IBL API has none).
    // Fetched at runtime and cached rather than shipped in this repo, like the thumbnails.
    async #channelIconSvgs(): Promise<Record<string, string>> {
        return this.longCache.getOr('channel_logos_v2', async () => {
            const page = await axios.get('https://www.bbc.co.uk/iplayer', { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = String(page.data);
            const nav: any[] = parseIplayerState(html)?.navigation?.items ?? [];
            const subItems: any[] = nav.find((item) => item?.id === 'channels')?.subItems ?? [];
            const found: Record<string, string> = {};
            for (const { id, icon } of subItems) {
                if (!/^[a-z0-9_]+$/i.test(String(id)) || !/^[a-z0-9]+$/i.test(String(icon))) continue;
                // The "-active" variant is the coloured one (brand-colour background + contrasting
                // letter mark) shown on iPlayer's own nav when a channel is selected; attribute order
                // on the <svg> varies between icons, so match viewBox/id independent of position.
                const match = new RegExp(
                    `<svg\\b[^>]*\\bviewBox="([^"]+)"[^>]*\\bid="iplayer-nav-icon-${icon}-active"[^>]*>(.*?)</svg>`,
                    's'
                ).exec(html);
                if (match) {
                    found[id] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${match[1]}">${match[2]}</svg>`;
                }
            }
            return found;
        });
    }

    async channelLogo(masterBrand: string): Promise<string | undefined> {
        if (isRadioStation(masterBrand)) {
            return this.#radioLogo(masterBrand);
        }
        const logos = await this.#channelIconSvgs();
        const optional = OptionalLiveChannels.find(({ id }) => id === masterBrand);
        if (optional) {
            const parent = logos[optional.masterBrand ?? ''];
            return parent && withCaption(parent, optional.label);
        }
        return logos[masterBrand];
    }

    // A radio station's logo is BBC Sounds' own coloured SVG for the network (LIVE_RADIO), set on a wide field of its own
    // colour so it is the shape of the TV logos (see wideRadioLogo).
    async #radioLogo(stationId: string): Promise<string | undefined> {
        const logoId = RadioStations.find(({ id }) => id === stationId)?.logoId ?? stationId;
        return this.longCache.getOr(`radio_logo_wide_${stationId}`, async () => {
            const response = await axios.get(`https://sounds.files.bbci.co.uk/v2/networks/${logoId}/colour_default.svg`, {
                responseType: 'text',
                timeout: 15_000,
            });
            return wideRadioLogo(String(response.data));
        });
    }

    // Each channel's brand colours (background + contrasting text), read off the same coloured
    // icon channelLogo() serves - the "-active" SVG's first two fills are the background rect and
    // the letter mark, in that order. Keyed the same way the channel pill CSS classes already are
    // (title with spaces stripped, e.g. "BBC One" -> "BBCOne") so the frontend can look them up
    // directly against whatever channel name a pill already carries.
    async channelColors(): Promise<Record<string, { bg: string; fg: string; name: string }>> {
        const radioFields: Record<string, string> = {};
        if (radioEnabled()) {
            await Promise.all(
                RadioStations.map(async ({ id }) => {
                    const logo = await this.#radioLogo(id).catch(() => undefined);
                    if (logo) radioFields[id] = radioFieldColor(logo);
                })
            );
        }
        return buildChannelColors(await this.#channelIconSvgs(), radioFields);
    }

    channels(): BrowseChannel[] {
        return BrowseChannels.map(withLogo);
    }

    async channel(id: string): Promise<{ channel?: BrowseChannel; rails: BrowseRail[]; nowNext?: BrowseNowNext }> {
        const found = BrowseChannels.find((c) => c.id === id);
        const channel = found && withLogo(found);
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
        const nowNext = await this.nowNext(id).catch((error) => {
            loggingService.error(`Browse now/next for ${id} failed (bn c58e29): ${error}`);
            return undefined;
        });
        return { channel, rails, nowNext };
    }

    atoz(letter: string, page?: number, perPage?: number): Promise<BrowsePage> {
        // IBL's bucket for titles starting with a digit is literally "0-9"; "0" is a 400.
        const bucket = letter === '0' ? '0-9' : letter.toLowerCase();
        return this.#listing(`atoz/${encodeURIComponent(bucket)}/programmes`, page, perPage);
    }

    // One page of a show's episodes (PROGRAMME_PAGE_SIZE from the BBC); callers walk `page` while `hasMore`.
    async programme(requestedPid: string, page: number = 1): Promise<BrowseProgramme> {
        const safePage = Number.isInteger(page) && page > 0 ? page : 1;
        let pid = requestedPid;
        let programme: IPlayerProgramMetadata;
        try {
            ({ programme } = await iplayerDetailsService.getMetadata(pid));
        } catch (error) {
            // The BBC's programme pages being down must not take the programme page with them.
            const degraded = await this.#programmeFromIbl(requestedPid, safePage).catch(() => undefined);
            if (degraded) {
                loggingService.log(`BBC programme page unavailable for ${requestedPid}; showing iPlayer listing data only [ref 0fb4d2] (${error})`);
                return degraded;
            }
            throw error;
        }
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
        let hasMore = false;
        if (kind === 'episode') {
            episodes = await this.#withAvailability(await iplayerDetailsService.details([pid]));
        } else {
            const batch = await iplayerDetailsService.getSeriesEpisodes(pid, safePage, PROGRAMME_PAGE_SIZE);
            hasMore = batch.length >= PROGRAMME_PAGE_SIZE;
            const metas = batch.filter((e) => e.type === 'episode');
            // The chunks are independent BBC lookups, so run them side by side (order is kept). A brand's own pid is
            // handed on so each episode needn't climb to it again.
            const brandPid = kind === 'brand' ? pid : undefined;
            const chunks = await Promise.all(
                splitArrayIntoChunks(metas, 5).map((chunk) => iplayerDetailsService.detailsForEpisodeMetadata(chunk, brandPid))
            );
            episodes = chunks.flat();
        }
        if (episodes.length === 0) {
            // Every episode lookup failed (the BBC's programme pages again): the listing API has the same data.
            const degraded = await this.#programmeFromIbl(pid, safePage).catch(() => undefined);
            if (degraded && degraded.seasons.length > 0) return degraded;
        }
        // Mark the episodes that have an audio described / signed version, for the badges, from what is cached
        // already. The rest are left unchecked: the page asks for them in the background (and only when it
        // shows those badges), so this response never waits on the BBC for them.
        episodes = await Promise.all(
            episodes.map(async (episode) => {
                const ids = await cachedVersionIds(episode.pid);
                return ids === undefined ? episode : { ...episode, versionsChecked: true, ...(ids.length ? { versions: ids } : {}) };
            })
        );
        return { ...base, seasons: this.#groupSeasons(episodes), page: safePage, hasMore };
    }

    // A lone episode's details come from the BBC's programme page, which says nothing of when it leaves iPlayer: that
    // (and the guidance flag) is read from iPlayer's own record of the episode. Best-effort: without it there is no badge.
    async #withAvailability(episodes: IPlayerDetails[]): Promise<IPlayerDetails[]> {
        return Promise.all(
            episodes.map(async (episode) => {
                const record = (await this.#ibl(`episodes/${encodeURIComponent(episode.pid)}`).catch(() => undefined))?.episodes?.[0];
                return { ...episode, ...parseAvailability(record) };
            })
        );
    }

    // The programme page from iPlayer's listing API only: used when the BBC's programme pages are unreachable.
    // An episode pid is climbed to its show through `tleo_id`. Returns undefined when iBL doesn't know the pid.
    async #programmeFromIbl(requestedPid: string, page: number): Promise<BrowseProgramme | undefined> {
        let show: any = (await this.#ibl(`programmes/${encodeURIComponent(requestedPid)}`))?.programmes?.[0];
        let lone: any;
        if (!show) {
            const episode = (await this.#ibl(`episodes/${encodeURIComponent(requestedPid)}`))?.episodes?.[0];
            if (!episode) return undefined;
            if (episode.tleo_id && episode.tleo_id !== requestedPid && episode.tleo_type !== 'episode') {
                show = (await this.#ibl(`programmes/${encodeURIComponent(episode.tleo_id)}`).catch(() => undefined))?.programmes?.[0];
            }
            if (!show) lone = episode;
        }
        const source = show ?? lone;
        const imageUrl: unknown = source.images?.standard;
        const imagePid = typeof imageUrl === 'string' ? IMAGE_PID_REGEX.exec(imageUrl)?.[1] : undefined;
        const base = {
            pid: source.id as string,
            kind: (lone ? 'episode' : KINDS.includes(source.tleo_type) ? source.tleo_type : 'brand') as BrowseKind,
            type: VideoType.TV,
            title: source.title as string,
            synopsis: (source.synopses?.medium ?? source.synopses?.large ?? source.synopses?.small) as string | undefined,
            thumbnail: imagePid ? `json-api/thumbnail/${imagePid}.jpg` : undefined,
            channel: (source.master_brand?.titles?.small ?? source.master_brand?.titles?.medium) as string | undefined,
            category: source.labels?.category as string | undefined,
        };
        const missing = (['synopsis', 'thumbnail', 'channel', 'category'] as const).filter((field) => !base[field]);

        let elements: any[];
        if (lone) {
            elements = [lone];
        } else {
            const data = await this.#ibl(`programmes/${encodeURIComponent(base.pid)}/episodes?per_page=${PROGRAMME_PAGE_SIZE}&page=${page}`);
            elements = data?.programme_episodes?.elements ?? [];
        }
        const episodes = elements.filter((e) => e?.type === 'episode' && e.id).map(iblEpisodeToDetails);
        return {
            ...base,
            seasons: this.#groupSeasons(episodes),
            page,
            hasMore: !lone && elements.length >= PROGRAMME_PAGE_SIZE,
            degraded: true,
            missing: [...missing],
        };
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
