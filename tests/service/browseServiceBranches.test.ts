import axios from 'axios';

import { setCustomRegistry } from '../../src/constants/CustomChannels';
import scheduleFacade from '../../src/facade/scheduleFacade';
import browseService, {
    buildChannelColors,
    iblEpisodeToDetails,
    parseIsoDurationMinutes,
    toBrowseItem,
    toBrowseSlot,
    withCaption,
} from '../../src/service/browseService';
import categoryDiscoverService from '../../src/service/categoryDiscoverService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import liveChannelService from '../../src/service/liveChannelService';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { cachedVersionIds } from '../../src/utils/videoVersion';

jest.mock('axios');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/utils/videoVersion', () => ({ cachedVersionIds: jest.fn() }));
jest.mock('../../src/service/categoryDiscoverService', () => ({ __esModule: true, default: { list: jest.fn() }, CategoryDiscoverError: class extends Error {} }));
jest.mock('../../src/service/db/dbCacheService', () => ({
    __esModule: true,
    default: class {
        async getOr(key: string, fn: (key: string) => Promise<unknown>) {
            return fn(key);
        }
        async set() {}
    },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedDetails = iplayerDetailsService as jest.Mocked<typeof iplayerDetailsService>;
const mockedSchedule = scheduleFacade as jest.Mocked<typeof scheduleFacade>;
const featured = categoryDiscoverService.list as jest.Mock;

const iblByPath = (routes: Record<string, any>) =>
    mockedAxios.get.mockImplementation(async (url: string) => {
        const key = Object.keys(routes).find((k) => url.includes(k));
        if (!key) throw new Error(`unrouted ${url}`);
        const value = routes[key];
        if (value instanceof Error) throw value;
        return { data: value };
    });

const episode = (id: string, extra: object = {}) => ({ id, type: 'episode', title: `Title ${id}`, ...extra });

beforeEach(() => {
    jest.resetAllMocks();
    featured.mockResolvedValue([]);
});
afterEach(() => setCustomRegistry([], {}));

describe('toBrowseSlot', () => {
    const broadcast = (over: object = {}) => ({ episode: episode('b001'), scheduled_start: '2024-05-01T10:00:00Z', scheduled_end: '2024-05-01T11:00:00Z', ...over });

    it('maps a broadcast, carrying its flags only when set', () => {
        expect(toBrowseSlot(broadcast())).toMatchObject({ start: '2024-05-01T10:00:00Z', end: '2024-05-01T11:00:00Z', repeat: undefined, live: undefined, childrens: undefined, categories: undefined });
        const flagged = toBrowseSlot(broadcast({ repeat: true, episode: episode('b001', { live: true, childrens: true, categories: ['drama'] }) }));
        expect(flagged).toMatchObject({ repeat: true, live: true, childrens: true, categories: ['drama'] });
    });

    it('ignores categories that are not a list', () => {
        expect(toBrowseSlot(broadcast({ episode: episode('b001', { categories: 'drama' }) }))?.categories).toBeUndefined();
    });

    it.each([
        ['no broadcast', undefined],
        ['no episode', { scheduled_start: 'a', scheduled_end: 'b' }],
        ['an episode that is not a programme kind', broadcast({ episode: { id: 'x', title: 'T', type: 'promo' } })],
        ['no start', broadcast({ scheduled_start: undefined })],
        ['no end', broadcast({ scheduled_end: undefined })],
    ])('drops %s', (_label, value) => {
        expect(toBrowseSlot(value)).toBeUndefined();
    });
});

describe('toBrowseItem artwork', () => {
    it('takes the portrait image, or the singular image field, when there is no standard one', () => {
        expect(toBrowseItem(episode('b001', { images: { portrait: 'https://ichef/ic/{recipe}/p0aaa111.jpg' } }))?.thumbnail).toBe('json-api/thumbnail/p0aaa111.jpg');
        expect(toBrowseItem(episode('b001', { image: { standard: 'https://ichef/ic/{recipe}/p0bbb222.jpg' } }))?.thumbnail).toBe('json-api/thumbnail/p0bbb222.jpg');
    });

    it('has no thumbnail when the image url is not a string or has no pid in it', () => {
        expect(toBrowseItem(episode('b001', { images: { standard: 5 } }))?.thumbnail).toBeUndefined();
        expect(toBrowseItem(episode('b001', { images: { standard: 'https://example/none' } }))?.thumbnail).toBeUndefined();
    });
});

describe('withCaption', () => {
    const svg = '<svg viewBox="0 0 100 40"><rect fill="#112233"/><path fill="#ffffff"/></svg>';

    it('returns a logo with no viewBox untouched', () => {
        expect(withCaption('<svg></svg>', 'Wales')).toBe('<svg></svg>');
    });

    it('draws the label under the logo on its own colours, escaping markup in it', () => {
        const out = withCaption(svg, 'A & <B>');
        expect(out).toContain('viewBox="0 0 100 40"');
        expect(out).toContain('fill="#112233"/>');
        expect(out).toContain('fill="#ffffff">A &amp; &lt;B></text>');
    });

    it('falls back to black on white when the logo has fewer than two fills, and to no artwork without an svg element', () => {
        expect(withCaption('<svg viewBox="0 0 100 40"><rect fill="#abcdef"/></svg>', 'X')).toContain('fill="#ffffff">X</text>');
        const bare = withCaption('viewBox="0 0 100 40"', 'X');
        expect(bare).toContain('fill="#000000"/>');
        expect(bare).toMatch(/<g transform="translate\(0 -5\.6[0-9]*\)"><\/g>/);
    });
});

describe('iblEpisodeToDetails', () => {
    it('reads series and episode from the subtitle and the original version\'s details', () => {
        const details = iblEpisodeToDetails({
            id: 'b001',
            title: 'Show',
            subtitle: 'Series 3: Episode 4',
            original_title: 'The Original',
            tleo_id: 'b000',
            images: { standard: 'https://ichef/ic/{recipe}/p0aaa111.jpg' },
            master_brand: { titles: { medium: 'BBC Two' } },
            labels: { category: 'Comedy' },
            synopses: { large: 'Large' },
            release_date_time: '2024-01-01T00:00:00Z',
            versions: [
                { kind: 'signed', duration: { value: 'PT10M' } },
                { kind: 'original', duration: { value: 'PT1H30M' }, first_broadcast_date_time: '2024-05-01T10:00:00Z' },
            ],
        });
        expect(details).toMatchObject({
            series: 3,
            episode: 4,
            episodeTitle: 'The Original',
            channel: 'BBC Two',
            category: 'Comedy',
            description: 'Large',
            runtime: 90,
            firstBroadcast: '2024-05-01T10:00:00Z',
            thumbnail: 'json-api/thumbnail/p0aaa111.jpg',
            seriesPid: 'b000',
            type: VideoType.TV,
        });
        expect(details.versions).toEqual(['signed']);
    });

    it('copes with a bare record: no subtitle, versions, images, labels or synopses', () => {
        const details = iblEpisodeToDetails({ id: 'b002', title: 'Bare', release_date_time: '2024-02-02T00:00:00Z' });
        expect(details).toMatchObject({ episode: undefined, series: undefined, episodeTitle: undefined, channel: undefined, category: '', description: undefined, runtime: 0, firstBroadcast: '2024-02-02T00:00:00Z', thumbnail: undefined });
    });

    it('uses the subtitle as the title when there is no original title, the first version when none is original, and the portrait image', () => {
        const details = iblEpisodeToDetails({
            id: 'b003',
            title: 'T',
            subtitle: 'Plain subtitle',
            images: { portrait: 'https://ichef/ic/{recipe}/p0ccc333.jpg' },
            synopses: { small: 'Small' },
            master_brand: { titles: { small: 'BBC One' } },
            versions: [{ kind: 'audio-described', duration: { value: 'PT45M' } }],
        });
        expect(details).toMatchObject({ episodeTitle: 'Plain subtitle', runtime: 45, description: 'Small', channel: 'BBC One', thumbnail: 'json-api/thumbnail/p0ccc333.jpg' });
    });
});

describe('parseIsoDurationMinutes', () => {
    it.each([
        ['PT30S', 0.5],
        ['PT1H', 60],
        ['PT5M', 5],
        ['PT1H1M30S', 61.5],
    ])('reads %s', (value, minutes) => {
        expect(parseIsoDurationMinutes(value)).toBe(minutes);
    });

    it.each([['PT'], [undefined], [null], ['1 hour'], [42]])('gives nothing for %j', (value) => {
        expect(parseIsoDurationMinutes(value)).toBeUndefined();
    });
});

describe('buildChannelColors', () => {
    it('uses the user\'s colour with readable text, the logo\'s own two fills, or nothing', async () => {
        await liveChannelService.list(); // loads the registry
        const withFills = '<svg><rect fill="#111111"/><path fill="#eeeeee"/></svg>';
        const one = '<svg><rect fill="#111111"/></svg>';
        const colors = buildChannelColors({ bbc_one: withFills, bbc_two: one });
        expect(colors.BBCOne).toMatchObject({ bg: '#111111', fg: '#eeeeee', name: 'BBC One' });
        expect(colors.BBCTwo).toBeUndefined();
        expect(colors.BBCThree).toBeUndefined();
    });
});

describe('listings and search', () => {
    it('lists a channel\'s programmes on a path that already has a query', async () => {
        iblByPath({ 'categories/comedy/programmes': { category_programmes: { elements: [episode('b001')], count: 12 } } });
        const page = await browseService.category('comedy', 2, 10);
        expect(page.total).toBe(12);
        expect(mockedAxios.get.mock.calls[0][0]).toContain('programmes?page=2&per_page=10');
    });

    it('has no total when the response carries no count', async () => {
        iblByPath({ 'categories/comedy/programmes': { category_programmes: { elements: [] } } });
        expect((await browseService.category('comedy')).total).toBeUndefined();
        iblByPath({ 'categories/comedy/programmes': null });
        expect((await browseService.category('comedy')).total).toBeUndefined();
    });

    it('categories treats a response with no list as no categories', async () => {
        iblByPath({ '/categories': {} });
        expect(await browseService.categories()).toEqual([]);
    });

    it('suggest treats a response with no results as none, and stops at the limit', async () => {
        iblByPath({ 'new-search': {} });
        expect(await browseService.suggest('abc')).toEqual([]);
        iblByPath({ 'new-search': { new_search: { results: ['a', 'b', 'c', 'd'].map((t, i) => ({ id: `b00${i}`, title: t })) } } });
        expect((await browseService.suggest('abc', 2)).map((s) => s.title)).toEqual(['a', 'b']);
    });

    it('skipMarkers reads the first episode from either response shape', async () => {
        const withSkip = { versions: [{ kind: 'original', interactions: [{ type: 'skip', subtype: 'intro', interaction_points: { show_from: 1, skip_to: 5 } }] }] };
        iblByPath({ 'episodes/b001': { episodes: [withSkip] } });
        expect(await browseService.skipMarkers('b001')).toHaveLength(1);
        iblByPath({ 'episodes/b001': { elements: [withSkip] } });
        expect(await browseService.skipMarkers('b001')).toHaveLength(1);
        iblByPath({ 'episodes/b001': {} });
        expect(await browseService.skipMarkers('b001')).toEqual([]);
    });
});

describe('recently added', () => {
    it('drops blank episode titles and channels instead of showing empty strings', async () => {
        mockedSchedule.getFeed.mockResolvedValue([{ pid: 'b001', title: 'T', channel: '', episodeTitle: '', type: VideoType.TV, pubDate: new Date() } as any]);
        mockedDetails.details.mockResolvedValue([]);
        const rail = await browseService.recentlyAdded();
        expect(rail?.items[0]).toMatchObject({ subtitle: undefined, episodeTitle: undefined, channel: undefined, synopsis: undefined, thumbnail: undefined });
    });
});

describe('channel rails', () => {
    it('titles an unknown channel by its id', async () => {
        iblByPath({ channels: { elements: [] } });
        expect((await browseService.channelRail('mystery_channel')).title).toBe('On mystery_channel');
    });

    it('matches a region\'s items against its national channel, and shows its own name', async () => {
        iblByPath({
            'channels/bbc_one_wales/highlights': { elements: [episode('b001', { master_brand: { titles: { small: 'BBC One' } } })] },
            'channels/bbc_one_wales/programmes': { elements: [] },
        });
        const rail = await browseService.channelRail('bbc_one_wales_hd');
        expect(rail.title).toBe('On BBC One Wales');
        expect(rail.items.map((i) => i.pid)).toEqual(['b001']);
    });

    it('shows the user\'s own name for a built-in channel', async () => {
        iblByPath({ channels: { elements: [] } });
        setCustomRegistry([], { bbc_one_london: { name: 'Beeb' } });
        expect((await browseService.channelRail('bbc_one_london')).title).toBe('On Beeb');
    });
});

describe('category rails on Discover', () => {
    it('titles a featured category from the list, or by its id when it is not there, and skips failures', async () => {
        featured.mockResolvedValue(['comedy', 'mystery', 'broken']);
        iblByPath({
            '/categories?': undefined,
            'categories/comedy/programmes?per_page=6': { elements: [] },
            'categories/mystery/programmes?per_page=6': { elements: [] },
            'categories/broken/programmes?per_page=6': { elements: [] },
            'categories/comedy/programmes?per_page=30': { elements: [episode('b001')] },
            'categories/mystery/programmes?per_page=30': { elements: [episode('b002')] },
            'categories/broken/programmes?per_page=30': new Error('boom'),
            categories: { categories: [{ id: 'comedy', title: 'Comedy' }] },
        });
        const rails = await browseService.discoverCategoryRails();
        expect(rails.map((r) => r.title)).toEqual(['Comedy', 'mystery']);
    });
});

const stateHtml = (state: unknown, svgs = '') => `<html>${svgs}<script>window.__IPLAYER_REDUX_STATE__ = ${JSON.stringify(state)};</script></html>`;
const icon = (id: string) => `<svg viewBox="0 0 100 40" id="iplayer-nav-icon-${id}-active"><rect fill="#111111"/><path fill="#ffffff"/></svg>`;

describe('home', () => {
    it('shows nothing, rather than failing, when the BBC can be reached for none of it', async () => {
        mockedAxios.get.mockRejectedValue(new Error('offline'));
        mockedSchedule.getFeed.mockResolvedValue([]);
        mockedDetails.details.mockResolvedValue([]);
        expect(await browseService.home()).toEqual([]);
    });
});

describe('random category rails', () => {
    it('skips a category whose programmes cannot be read', async () => {
        const original = Math.random;
        jest.spyOn(Math, 'random').mockReturnValue(0.5);
        iblByPath({
            'programmes?per_page=6': { elements: [] },
            'good/programmes?per_page=30': { elements: [episode('b001')] },
            'bad/programmes?per_page=30': new Error('boom'),
            categories: { categories: [{ id: 'good', title: 'Good' }, { id: 'bad', title: 'Bad' }] },
        });
        const rails = await browseService.randomCategoryRails(2);
        expect(rails.map((r) => r.id)).toEqual(['category_good']);
        Math.random = original;
    });
});

describe('schedule', () => {
    it('defaults to today in London and keeps a channel whose schedule cannot be read', async () => {
        mockedAxios.get.mockRejectedValue(new Error('offline'));
        const rows = await browseService.schedule();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.slots.length === 0)).toBe(true);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
        expect(mockedAxios.get.mock.calls.some(([url]) => String(url).endsWith(`/schedule/${today}`))).toBe(true);
    });
});

describe('category rails from the page state', () => {
    it('gives no rails when the page has no bundle list', async () => {
        mockedAxios.get.mockResolvedValue({ data: stateHtml({ bundles: 'none' }) });
        expect(await browseService.categoryRails('comedy')).toEqual([]);
        mockedAxios.get.mockResolvedValue({ data: '<html>no state</html>' });
        expect(await browseService.categoryRails('drama')).toEqual([]);
    });

    it('keeps only group bundles that have an id and a title', async () => {
        const bundle = (id: string, over: object = {}) => ({ id, title: { default: `Rail ${id}` }, journey: { type: 'group', id: `grp-${id}` }, ...over });
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.includes('/groups/')) return { data: { elements: [episode('b001')] } };
            return {
                data: stateHtml({
                    bundles: [
                        bundle('ok'),
                        bundle('not-group', { journey: { type: 'programme', id: 'x' } }),
                        bundle('no-journey-id', { journey: { type: 'group' } }),
                        bundle('blank-title', { title: { default: '   ' } }),
                        bundle('no-title', { title: undefined }),
                        null,
                    ],
                }),
            };
        });
        const rails = await browseService.categoryRails('film');
        expect(rails.map((r) => r.id)).toEqual(['ok']);
    });
});

describe('channel logos from the iPlayer page', () => {
    const page = (items: unknown, svgs = '') => ({ data: stateHtml({ navigation: { items } }, svgs) });

    it('finds nothing when the page has no navigation, no channels entry, or unsafe ids', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: '<html></html>' });
        expect(await browseService.channelLogo('bbc_one')).toBeUndefined();
    });

    it.each([
        ['no channels entry', [{ id: 'home', subItems: [] }]],
        ['no sub items', [{ id: 'channels' }]],
        ['an unsafe channel id', [{ id: 'channels', subItems: [{ id: 'bbc one!', icon: 'bbcone' }] }]],
        ['an unsafe icon name', [{ id: 'channels', subItems: [{ id: 'bbc_one', icon: 'bbc-one<' }] }]],
        ['an icon the page does not contain', [{ id: 'channels', subItems: [{ id: 'bbc_one', icon: 'missing' }] }]],
    ])('finds no logo for %s', async (_label, items) => {
        mockedAxios.get.mockResolvedValueOnce(page(items, icon('bbcone')));
        expect(await browseService.channelLogo('bbc_one')).toBeUndefined();
    });

    it('serves the coloured icon, and a region\'s logo as its parent\'s with the region written under it', async () => {
        const items = [{ id: 'channels', subItems: [{ id: 'bbc_one', icon: 'bbcone' }] }];
        mockedAxios.get.mockResolvedValue(page(items, icon('bbcone')));
        expect(await browseService.channelLogo('bbc_one')).toContain('viewBox="0 0 100 40"');
        const regional = await browseService.channelLogo('bbc_one_wales_hd');
        expect(regional).toContain('>Wales</text>');
    });

    it('has no logo for a region whose parent channel has none', async () => {
        mockedAxios.get.mockResolvedValue(page([{ id: 'channels', subItems: [] }]));
        expect(await browseService.channelLogo('bbc_one_wales_hd')).toBeUndefined();
    });
});

describe('programme page', () => {
    const brand = (over: object = {}) => ({ programme: { type: 'brand', pid: 'b00brand', title: 'Brand', ...over } });
    const detail = (pid: string, over: object = {}) => ({ pid, title: 'B', type: VideoType.TV, ...over }) as any;

    beforeEach(() => {
        mockedDetails.getSeriesEpisodes.mockResolvedValue([{ id: 'e1', type: 'episode', title: 'e1' }] as any);
        mockedDetails.detailsForEpisodeMetadata.mockResolvedValue([detail('e1', { series: 1, episode: 1 })]);
    });

    it.each([[0], [-3], [1.5], [NaN]])('treats a page of %s as the first', async (page) => {
        mockedDetails.getMetadata.mockResolvedValue(brand() as any);
        expect((await browseService.programme('b00brand', page)).page).toBe(1);
    });

    it('names the first category, or none', async () => {
        mockedDetails.getMetadata.mockResolvedValue(brand({ categories: [{ title: 'Drama' }, { title: 'Crime' }] }) as any);
        expect((await browseService.programme('b00brand')).category).toBe('Drama');
        mockedDetails.getMetadata.mockResolvedValue(brand({ categories: [] }) as any);
        expect((await browseService.programme('b00brand')).category).toBeUndefined();
    });

    it('marks an episode checked for versions once the answer is known, listing them when there are any', async () => {
        mockedDetails.getMetadata.mockResolvedValue(brand() as any);
        mockedDetails.detailsForEpisodeMetadata.mockResolvedValue([detail('e1'), detail('e2'), detail('e3')]);
        (cachedVersionIds as jest.Mock).mockImplementation(async (pid: string) => ({ e1: undefined, e2: [], e3: ['signed'] })[pid]);
        const episodes = (await browseService.programme('b00brand')).seasons.flatMap((season) => season.episodes);
        const byPid = Object.fromEntries(episodes.map((e) => [e.pid, e]));
        expect(byPid.e1.versionsChecked).toBeUndefined();
        expect(byPid.e2).toMatchObject({ versionsChecked: true });
        expect(byPid.e2.versions).toBeUndefined();
        expect(byPid.e3).toMatchObject({ versionsChecked: true, versions: ['signed'] });
    });

    it('orders seasons and episodes with unnumbered ones last', async () => {
        mockedDetails.getMetadata.mockResolvedValue(brand() as any);
        mockedDetails.detailsForEpisodeMetadata.mockResolvedValue([
            detail('x', { series: undefined, episode: 1 }),
            detail('a', { series: 2, episode: undefined }),
            detail('b', { series: 2, episode: 3 }),
            detail('c', { series: 1, episode: 5 }),
            detail('d', { series: 2, episode: 1 }),
        ]);
        const result = await browseService.programme('b00brand');
        expect(result.seasons.map((s) => s.series)).toEqual([1, 2, undefined]);
        expect(result.seasons[1].episodes.map((e) => e.pid)).toEqual(['d', 'b', 'a']);
    });

    it('puts an unnumbered season last wherever it appears in the list', async () => {
        mockedDetails.getMetadata.mockResolvedValue(brand() as any);
        mockedDetails.detailsForEpisodeMetadata.mockResolvedValue([
            detail('b', { series: 2, episode: 1 }),
            detail('x', { series: undefined, episode: 1 }),
            detail('a', { series: 1, episode: 1 }),
        ]);
        expect((await browseService.programme('b00brand')).seasons.map((s) => s.series)).toEqual([1, 2, undefined]);
    });

    describe('from the iPlayer listing alone', () => {
        beforeEach(() => mockedDetails.getMetadata.mockRejectedValue(new Error('BBC down')));
        const route = (table: Record<string, unknown>) =>
            mockedAxios.get.mockImplementation(async (url: string) => {
                const key = Object.keys(table).find((k) => url.endsWith(k));
                if (!key) throw new Error(`unexpected ${url}`);
                return { data: table[key] };
            });
        const show = (over: object = {}) => ({ id: 'p09show', title: 'Show', tleo_type: 'series', ...over });
        const ep = (id: string, over: object = {}) => ({ id, type: 'episode', title: 'Ep', ...over });

        it('uses the show\'s own kind when it is a known one, else calls it a brand', async () => {
            route({ 'programmes/p09show': { programmes: [show()] }, 'programmes/p09show/episodes?per_page=30&page=1': {} });
            expect((await browseService.programme('p09show')).kind).toBe('series');
            route({ 'programmes/p09show': { programmes: [show({ tleo_type: 'mystery' })] }, 'programmes/p09show/episodes?per_page=30&page=1': {} });
            expect((await browseService.programme('p09show')).kind).toBe('brand');
        });

        it('takes the channel from the medium title, and lists every field as missing when the show has none', async () => {
            route({
                'programmes/p09show': { programmes: [show({ master_brand: { titles: { medium: 'BBC Four' } } })] },
                'programmes/p09show/episodes?per_page=30&page=1': { programme_episodes: { elements: [] } },
            });
            const result = await browseService.programme('p09show');
            expect(result.channel).toBe('BBC Four');
            expect(result.missing).toEqual(['synopsis', 'thumbnail', 'category']);
            expect(result.seasons).toEqual([]);
        });

        it('has no channel when the show names none', async () => {
            route({ 'programmes/p09show': { programmes: [show()] }, 'programmes/p09show/episodes?per_page=30&page=1': { programme_episodes: { elements: [] } } });
            expect((await browseService.programme('p09show')).channel).toBeUndefined();
        });

        it('orders unnumbered episodes and seasons last', async () => {
            route({
                'programmes/p09show': { programmes: [show()] },
                'programmes/p09show/episodes?per_page=30&page=1': {
                    programme_episodes: {
                        elements: [
                            ep('u', { subtitle: 'No numbers' }),
                            ep('s2e2', { subtitle: 'Series 2: Episode 2' }),
                            ep('s2e1', { subtitle: 'Series 2: Episode 1' }),
                            ep('s2x', { subtitle: 'Series 2' }),
                            ep('s1e1', { subtitle: 'Series 1: Episode 1' }),
                        ],
                    },
                },
            });
            const result = await browseService.programme('p09show');
            expect(result.seasons.map((s) => s.series)).toEqual([1, 2, undefined]);
            expect(result.seasons[1].episodes.map((e) => e.pid)).toEqual(['s2e1', 's2e2', 's2x']);
        });
    });
});

describe('function coverage extras', () => {
    it('orders a channel\'s schedule by start time', async () => {
        const broadcast = (id: string, start: string) => ({ episode: episode(id), scheduled_start: start, scheduled_end: '2024-05-01T23:00:00Z' });
        mockedAxios.get.mockResolvedValue({
            data: { schedule: { elements: [broadcast('late', '2024-05-01T20:00:00Z'), broadcast('early', '2024-05-01T08:00:00Z')] } },
        });
        const [row] = await browseService.schedule('2024-05-01');
        expect(row.slots.map(({ start }) => start)).toEqual(['2024-05-01T08:00:00Z', '2024-05-01T20:00:00Z']);
    });

    it('reads each channel\'s brand colours off the iPlayer page', async () => {
        const items = [{ id: 'channels', subItems: [{ id: 'bbc_one', icon: 'bbcone' }] }];
        mockedAxios.get.mockResolvedValue({ data: stateHtml({ navigation: { items } }, icon('bbcone')) });
        const colours = await browseService.channelColors();
        expect(Object.values(colours)).toContainEqual(expect.objectContaining({ bg: '#111111', fg: '#ffffff' }));
    });

    describe('programme when lookups fail', () => {
        it('reports the original error when the listing cannot help either', async () => {
            mockedDetails.getMetadata.mockRejectedValue(new Error('BBC down'));
            mockedAxios.get.mockRejectedValue(new Error('offline'));
            await expect(browseService.programme('p09gone')).rejects.toThrow('BBC down');
        });

        it('stays on the episode when its show cannot be worked out', async () => {
            mockedDetails.getMetadata.mockResolvedValue({ programme: { type: 'episode', pid: 'p09ep', title: 'Ep' } } as any);
            mockedDetails.findBrandForPid.mockRejectedValue(new Error('BBC down'));
            mockedDetails.details.mockResolvedValue([{ pid: 'p09ep', title: 'Ep', type: VideoType.TV, series: 1, episode: 1 } as any]);
            const result = await browseService.programme('p09ep');
            expect(result.pid).toBe('p09ep');
        });

        it('shows the lone episode when its show cannot be fetched from the listing', async () => {
            mockedDetails.getMetadata.mockRejectedValue(new Error('BBC down'));
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url.endsWith('programmes/p09ep')) return { data: { programmes: [] } };
                if (url.endsWith('episodes/p09ep')) return { data: { episodes: [{ id: 'p09ep', title: 'Lone', tleo_id: 'p09show', tleo_type: 'series' }] } };
                throw new Error(`unrouted ${url}`);
            });
            const result = await browseService.programme('p09ep');
            expect(result.title).toBe('Lone');
        });
    });
});
