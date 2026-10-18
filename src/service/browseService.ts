import axios from 'axios';

import { BrowseChannels, BrowseHomeChannelRails, BrowseHomeRails, BrowseHomeRandomCategories } from '../constants/BrowseChannels';
import { searchResultLimit } from '../constants/iPlayarrConstants';
import { isLiveChannel, OptionalLiveChannels } from '../constants/LiveChannels';
import scheduleFacade from '../facade/scheduleFacade';
import {
    BrowseCategory,
    BrowseChannel,
    BrowseChannelSchedule,
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
import { splitArrayIntoChunks } from '../utils/Utils';
import DbCacheService from './db/dbCacheService';
import iplayerDetailsService from './iplayerDetailsService';
import liveChannelService from './liveChannelService';
import loggingService from './loggingService';

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

// The JSON blob iPlayer's pages embed as window.__IPLAYER_REDUX_STATE__.
export function parseIplayerState(html: string): any {
    const match = /__IPLAYER_REDUX_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s.exec(html);
    if (!match) return undefined;
    try {
        return JSON.parse(match[1]);
    } catch {
        return undefined;
    }
}

// iPlayer flags every version of an episode `hd` / `hdr` / `uhd`. An episode carries `versions` itself;
// a programme/series/brand list item carries its latest episode as `initial_children[0]`, so for those
// the flags describe the latest episode only. The original version is used (the audio-described and
// signed cuts are not what anyone browses for).
export function parseQualityFlags(element: any): { hdr?: true; uhd?: true } {
    const versions: any[] = element?.versions ?? element?.initial_children?.[0]?.versions ?? [];
    const version = versions.find((v) => v?.kind === 'original') ?? versions[0];
    return { ...(version?.hdr === true ? { hdr: true as const } : {}), ...(version?.uhd === true ? { uhd: true as const } : {}) };
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

    const imageUrl: string | undefined = element.images?.standard ?? element.images?.portrait ?? element.image?.standard;
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
// keeps its standard size: the icon is shrunk to leave a strip along the bottom, and a long name gets a
// smaller font rather than a wider canvas.
export function withCaption(svg: string, label: string): string {
    const box = /viewBox="([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
    if (!box) return svg;
    const [x, y, w, h] = box.slice(1).map(Number);
    const fills = Array.from(svg.matchAll(/fill="(#[0-9a-f]{3,8})"/gi)).map((m) => m[1]);
    const [bg, fg] = [fills[0] ?? '#000000', fills[1] ?? '#ffffff'];
    const inner = /<svg\b[^>]*>(.*)<\/svg>/s.exec(svg)?.[1] ?? '';
    const scale = 0.6;
    const fontSize = Math.min(h * 0.26, (w - 4) / label.length / 0.7);
    const text = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` +
        `<svg x="${x + (w * (1 - scale)) / 2}" y="${y + h * 0.03}" width="${w * scale}" height="${h * scale}" viewBox="${x} ${y} ${w} ${h}">${inner}</svg>` +
        `<text x="${x + w / 2}" y="${y + h * 0.93}" text-anchor="middle" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" ` +
        `font-weight="bold" font-size="${fontSize}" fill="${fg}">${text}</text></svg>`
    );
}

const withLogo = (channel: BrowseChannel): BrowseChannel => ({
    ...channel,
    logo: channel.masterBrand ? `json-api/browse/channel-logo/${channel.masterBrand}.svg` : undefined,
    live: isLiveChannel(channel.id),
});

const PROGRAMME_PAGE_SIZE = 30;

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
    shortCache: DbCacheService<any> = new DbCacheService('browse_short', 900); // 15 minutes
    longCache: DbCacheService<any> = new DbCacheService('browse_long', 86400); // 24 hours

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
        // A channel switched off on the Channels page is not featured here either.
        for (const id of BrowseHomeChannelRails) {
            if (await liveChannelService.isEnabled(id)) {
                sources.push({ id: `channel_${id}`, load: async () => [await this.channelRail(id)] });
            }
        }
        sources.push({ id: 'categories', load: () => this.randomCategoryRails(BrowseHomeRandomCategories) });
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
        const title = BrowseChannels.find((c) => c.id === id)?.title ?? id;
        const own = (items: BrowseItem[]) => items.filter((item) => item.channel === title);
        const encoded = encodeURIComponent(id);
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
        return { id: `channel_${id}`, title: `On ${title}`, items };
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

    async categories(): Promise<BrowseCategory[]> {
        return this.longCache.getOr('category_tiles_v2', async () => {
            const data = await this.#ibl('categories', this.longCache);
            const list: any[] = Array.isArray(data?.categories) ? data.categories : [];
            const categories = list.filter((c) => c?.id && c?.title);
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

    // Title-only type-ahead for the search box.
    async suggest(term: string, limit: number = 8): Promise<BrowseSuggestion[]> {
        const query = term.trim();
        if (query.length < 2) return [];
        const data = await this.#ibl(`new-search?q=${encodeURIComponent(query)}`);
        const results: any[] = data?.new_search?.results ?? [];
        const seen = new Set<string>();
        const suggestions: BrowseSuggestion[] = [];
        for (const { id, title } of results) {
            const key = String(title).toLowerCase();
            if (id && title && !seen.has(key)) {
                seen.add(key);
                suggestions.push({ pid: id, title });
            }
            if (suggestions.length >= limit) break;
        }
        return suggestions;
    }

    async skipMarkers(pid: string): Promise<BrowseSkipMarker[]> {
        const data = await this.#ibl(`episodes/${pid}`, this.longCache);
        return parseSkipMarkers(extractElements(data)[0] ?? data?.episodes?.[0]);
    }

    // What's on a channel right now and what follows. The day's schedule is cached; "now" is
    // evaluated per request. Looks at adjacent days when today's schedule doesn't cover both.
    async nowNext(channelId: string, at: Date = new Date()): Promise<BrowseNowNext> {
        const slots: BrowseSlot[] = [];
        // iPlayer's schedule day runs 05:00-05:00, so in the small hours what's live is still in
        // yesterday's schedule; today's is tried first since it answers most of the time.
        for (const offset of [0, -1, 1]) {
            const day = new Date(at.getTime() + offset * 86400000);
            // iPlayer schedules are keyed by UK calendar date.
            const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(day);
            const data = await this.#ibl(`channels/${encodeURIComponent(channelId)}/schedule/${date}`);
            for (const broadcast of extractElements(data)) {
                const slot = toBrowseSlot(broadcast);
                if (slot) slots.push(slot);
            }
            const found = this.#pickNowNext(slots, at);
            if (found.now && found.next) return found;
        }
        return this.#pickNowNext(slots, at);
    }

    #pickNowNext(slots: BrowseSlot[], at: Date): BrowseNowNext {
        const time = at.getTime();
        const sorted = [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        const now = sorted.find((s) => Date.parse(s.start) <= time && time < Date.parse(s.end));
        const next = sorted.find((s) => Date.parse(s.start) > time);
        return { now, next };
    }

    // Every channel's full day, for the multi-channel guide grid. Reuses the same per-channel,
    // per-date IBL path nowNext() hits, so it rides the same 15-minute cache.
    async schedule(date?: string): Promise<BrowseChannelSchedule[]> {
        const day = date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
        const shown: BrowseChannel[] = [];
        for (const channel of BrowseChannels) {
            // Channels switched off on the Channels page drop out of the guide grid too.
            if (!isLiveChannel(channel.id) || (await liveChannelService.isEnabled(channel.id))) shown.push(channel);
        }
        const settled = await Promise.allSettled(
            shown.map(async (channel): Promise<BrowseChannelSchedule> => {
                const slots: BrowseSlot[] = [];
                const data = await this.#ibl(`channels/${encodeURIComponent(channel.id)}/schedule/${day}`);
                for (const broadcast of extractElements(data)) {
                    const slot = toBrowseSlot(broadcast);
                    if (slot) slots.push(slot);
                }
                slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
                return { channel: withLogo(channel), slots };
            })
        );
        return settled
            .filter((r): r is PromiseFulfilledResult<BrowseChannelSchedule> => r.status === 'fulfilled')
            .map((r) => r.value);
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
        const logos = await this.#channelIconSvgs();
        const optional = OptionalLiveChannels.find(({ id }) => id === masterBrand);
        if (optional) {
            const parent = logos[optional.masterBrand ?? ''];
            return parent && withCaption(parent, optional.label);
        }
        return logos[masterBrand];
    }

    // Each channel's brand colours (background + contrasting text), read off the same coloured
    // icon channelLogo() serves - the "-active" SVG's first two fills are the background rect and
    // the letter mark, in that order. Keyed the same way the channel pill CSS classes already are
    // (title with spaces stripped, e.g. "BBC One" -> "BBCOne") so the frontend can look them up
    // directly against whatever channel name a pill already carries.
    async channelColors(): Promise<Record<string, { bg: string; fg: string }>> {
        const icons = await this.#channelIconSvgs();
        const colors: Record<string, { bg: string; fg: string }> = {};
        for (const channel of BrowseChannels) {
            const svg = channel.masterBrand && icons[channel.masterBrand];
            if (!svg) continue;
            const fills = Array.from(svg.matchAll(/fill="(#[0-9a-f]{3,8})"/gi)).map((m) => m[1]);
            if (fills.length >= 2) {
                colors[channel.title.replaceAll(' ', '')] = { bg: fills[0], fg: fills[1] };
            }
        }
        return colors;
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
            loggingService.error(`Browse now/next for ${id} failed: ${error}`);
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
        let hasMore = false;
        if (kind === 'episode') {
            episodes = await iplayerDetailsService.details([pid]);
        } else {
            const batch = await iplayerDetailsService.getSeriesEpisodes(pid, safePage, PROGRAMME_PAGE_SIZE);
            hasMore = batch.length >= PROGRAMME_PAGE_SIZE;
            const metas = batch.filter((e) => e.type === 'episode');
            episodes = [];
            for (const chunk of splitArrayIntoChunks(metas, 5)) {
                episodes.push(...(await iplayerDetailsService.detailsForEpisodeMetadata(chunk)));
            }
        }
        return { ...base, seasons: this.#groupSeasons(episodes), page: safePage, hasMore };
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
