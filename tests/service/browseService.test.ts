import axios from 'axios';

import scheduleFacade from '../../src/facade/scheduleFacade';
import browseService, { extractElements, parseIplayerState, toBrowseItem, toBrowseItems } from '../../src/service/browseService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { VideoType } from '../../src/types/IPlayerSearchResult';

jest.mock('axios');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/redis/redisCacheService', () => ({
    __esModule: true,
    default: class {
        async getOr(key: string, fn: (key: string) => Promise<unknown>) {
            return fn(key);
        }
    },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedDetails = iplayerDetailsService as jest.Mocked<typeof iplayerDetailsService>;
const mockedSchedule = scheduleFacade as jest.Mocked<typeof scheduleFacade>;

const element = (id: string, extra: object = {}) => ({
    id,
    type: 'episode',
    title: `Title ${id}`,
    subtitle: `Sub ${id}`,
    synopses: { small: 'Small synopsis' },
    images: { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0abc123.jpg' },
    master_brand: { titles: { small: 'BBC One' } },
    labels: { category: 'Drama' },
    ...extra,
});

describe('browseService helpers', () => {
    it('extractElements finds elements under any wrapper key', () => {
        expect(extractElements({ elements: [1] })).toEqual([1]);
        expect(extractElements({ category_programmes: { elements: [2], count: 5 } })).toEqual([2]);
        expect(extractElements({ nothing: {} })).toEqual([]);
        expect(extractElements(undefined)).toEqual([]);
    });

    it('toBrowseItem maps an IBL element', () => {
        expect(toBrowseItem(element('b001'))).toEqual({
            pid: 'b001',
            kind: 'episode',
            type: VideoType.TV,
            title: 'Title b001',
            subtitle: 'Sub b001',
            episodeTitle: 'Sub b001',
            synopsis: 'Small synopsis',
            thumbnail: 'json-api/thumbnail/p0abc123.jpg',
            channel: 'BBC One',
            category: 'Drama',
        });
    });

    it('toBrowseItem only sets episodeTitle for episodes and tolerates missing images', () => {
        const item = toBrowseItem(element('b002', { type: 'brand', images: undefined }));
        expect(item?.kind).toBe('brand');
        expect(item?.episodeTitle).toBeUndefined();
        expect(item?.thumbnail).toBeUndefined();
    });

    it('toBrowseItem rejects elements without id or title', () => {
        expect(toBrowseItem({ title: 'x' })).toBeUndefined();
        expect(toBrowseItem({ id: 'x' })).toBeUndefined();
        expect(toBrowseItem(null)).toBeUndefined();
    });

    it('toBrowseItems drops invalid and duplicate entries', () => {
        const items = toBrowseItems([element('a1'), element('a1'), { id: 'bad' }, element('a2')]);
        expect(items.map((i) => i.pid)).toEqual(['a1', 'a2']);
    });
});

describe('browseService', () => {
    beforeEach(() => jest.resetAllMocks());

    const feedResult = (pid: string, daysAgo: number) => ({
        number: 0,
        pid,
        title: `Feed ${pid}`,
        channel: 'BBC Two',
        episodeTitle: `Ep ${pid}`,
        type: VideoType.TV,
        request: { term: '*', line: '*' },
        pubDate: new Date(Date.now() - daysAgo * 86400000),
    });

    it('home returns non-empty rails and drops failed ones', async () => {
        mockedAxios.get
            .mockResolvedValueOnce({ data: { home_highlights: { elements: [element('h1')] } } })
            .mockRejectedValueOnce(new Error('boom'));
        mockedSchedule.getFeed.mockResolvedValue([]);
        const rails = await browseService.home();
        expect(rails).toHaveLength(1);
        expect(rails[0].id).toBe('highlights');
        expect(rails[0].items[0].pid).toBe('h1');
    });

    it('home places Recently Added after Featured', async () => {
        mockedAxios.get.mockResolvedValue({ data: { elements: [element('x1')] } });
        mockedSchedule.getFeed.mockResolvedValue([feedResult('f1', 1)]);
        mockedDetails.details.mockResolvedValue([]);
        const rails = await browseService.home();
        expect(rails.map((r) => r.id)).toEqual(['highlights', 'recent', 'popular']);
    });

    it('recentlyAdded sorts newest first, caps the list and enriches from details', async () => {
        mockedSchedule.getFeed.mockResolvedValue([
            feedResult('old', 5),
            feedResult('new', 1),
            { ...feedResult('undated', 0), pubDate: undefined },
            feedResult('mid', 3),
        ]);
        mockedDetails.details.mockResolvedValue([
            { pid: 'new', title: 'T', thumbnail: 'json-api/thumbnail/p0new.jpg', description: 'Fresh', category: 'Drama', type: VideoType.TV },
        ]);
        const rail = await browseService.recentlyAdded(2);
        expect(rail?.title).toBe('Recently Added');
        expect(rail?.items.map((i) => i.pid)).toEqual(['new', 'mid']);
        expect(rail?.items[0]).toMatchObject({
            thumbnail: 'json-api/thumbnail/p0new.jpg',
            synopsis: 'Fresh',
            category: 'Drama',
            channel: 'BBC Two',
            episodeTitle: 'Ep new',
        });
        expect(mockedDetails.details).toHaveBeenCalledWith(['new', 'mid']);
    });

    it('recentlyAdded returns undefined for an empty feed', async () => {
        mockedSchedule.getFeed.mockResolvedValue([]);
        mockedDetails.details.mockResolvedValue([]);
        expect(await browseService.recentlyAdded()).toBeUndefined();
    });

    it('details delegates to iplayerDetailsService', async () => {
        mockedDetails.details.mockResolvedValue([{ pid: 'a', title: 'A', type: VideoType.TV }]);
        expect(await browseService.details(['a'])).toEqual([{ pid: 'a', title: 'A', type: VideoType.TV }]);
        expect(mockedDetails.details).toHaveBeenCalledWith(['a']);
    });

    it('categories maps and filters the list', async () => {
        mockedAxios.get.mockResolvedValue({ data: { categories: [{ id: 'comedy', title: 'Comedy' }, { id: 'x' }] } });
        expect(await browseService.categories()).toEqual([{ id: 'comedy', title: 'Comedy' }]);
    });

    it('category builds a paged URL and reports the total', async () => {
        mockedAxios.get.mockResolvedValue({
            data: { category_programmes: { elements: [element('c1')], count: 42 } },
        });
        const result = await browseService.category('comedy', 2, 10);
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://ibl.api.bbc.co.uk/ibl/v1/categories/comedy/programmes?page=2&per_page=10'
        );
        expect(result).toMatchObject({ page: 2, perPage: 10, total: 42 });
        expect(result.items[0].pid).toBe('c1');
    });

    it('clamps nonsense paging values', async () => {
        mockedAxios.get.mockResolvedValue({ data: {} });
        const result = await browseService.atoz('A', -5, 100000);
        expect(result.page).toBe(1);
        expect(result.perPage).toBe(150);
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('atoz/a/programmes'));
    });

    it('atoz maps the digit bucket to the IBL 0-9 bucket', async () => {
        mockedAxios.get.mockResolvedValue({ data: {} });
        await browseService.atoz('0');
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('atoz/0-9/programmes'));
    });

    it('channel returns the known channel plus rails', async () => {
        mockedAxios.get
            .mockResolvedValueOnce({ data: { channel_programmes: { elements: [element('p1')] } } })
            .mockResolvedValueOnce({ data: { channel_highlights: { elements: [element('f1')] } } });
        const result = await browseService.channel('bbc_one_london');
        expect(result.channel?.title).toBe('BBC One');
        expect(result).toHaveProperty('nowNext');
        expect(result.rails.map((r) => r.id)).toEqual(['highlights', 'programmes']);
    });

    it('categories borrows artwork from each first programme and tolerates failures', async () => {
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/categories')) {
                return { data: { categories: [{ id: 'comedy', title: 'Comedy' }, { id: 'news', title: 'News' }] } };
            }
            if (url.includes('categories/comedy/')) return { data: { category_programmes: { elements: [element('c1')] } } };
            throw new Error('boom');
        });
        expect(await browseService.categories()).toEqual([
            { id: 'comedy', title: 'Comedy', thumbnail: 'json-api/thumbnail/p0abc123.jpg' },
            { id: 'news', title: 'News' },
        ]);
    });

    it('suggest returns de-duplicated titles and ignores short terms', async () => {
        mockedAxios.get.mockResolvedValue({
            data: {
                new_search: {
                    results: [
                        { id: 'a1', title: 'Doctor Who' },
                        { id: 'a2', title: 'doctor who' },
                        { id: 'a3', title: 'Doctors' },
                    ],
                },
            },
        });
        expect(await browseService.suggest('d')).toEqual([]);
        expect(mockedAxios.get).not.toHaveBeenCalled();
        expect(await browseService.suggest(' doct ')).toEqual([
            { pid: 'a1', title: 'Doctor Who' },
            { pid: 'a3', title: 'Doctors' },
        ]);
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('new-search?q=doct'));
    });

    const broadcast = (id: string, start: string, end: string) => ({
        scheduled_start: start,
        scheduled_end: end,
        episode: element(id),
    });

    it('nowNext picks the live and following broadcasts', async () => {
        mockedAxios.get.mockResolvedValue({
            data: {
                schedule: {
                    elements: [
                        broadcast('s3', '2026-10-03T20:00:00Z', '2026-10-03T21:00:00Z'),
                        broadcast('s1', '2026-10-03T18:00:00Z', '2026-10-03T19:00:00Z'),
                        broadcast('s2', '2026-10-03T19:00:00Z', '2026-10-03T20:00:00Z'),
                    ],
                },
            },
        });
        const result = await browseService.nowNext('bbc_one_london', new Date('2026-10-03T19:30:00Z'));
        expect(result.now?.item.pid).toBe('s2');
        expect(result.next?.item.pid).toBe('s3');
    });

    it('nowNext falls through to tomorrow when today has no next slot', async () => {
        mockedAxios.get
            .mockResolvedValueOnce({
                data: { schedule: { elements: [broadcast('late', '2026-10-03T23:00:00Z', '2026-10-04T00:30:00Z')] } },
            })
            .mockResolvedValueOnce({
                data: { schedule: { elements: [broadcast('early', '2026-10-04T00:30:00Z', '2026-10-04T05:00:00Z')] } },
            });
        const result = await browseService.nowNext('bbc_one_london', new Date('2026-10-03T23:30:00Z'));
        expect(result.now?.item.pid).toBe('late');
        expect(result.next?.item.pid).toBe('early');
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    const stateHtml = (bundles: object[]) =>
        `<html><script>window.__IPLAYER_REDUX_STATE__ = ${JSON.stringify({ bundles })};</script></html>`;

    it('parseIplayerState extracts the embedded state and tolerates junk', () => {
        expect(parseIplayerState(stateHtml([{ id: 'a' }]))).toEqual({ bundles: [{ id: 'a' }] });
        expect(parseIplayerState('<html>nothing</html>')).toBeUndefined();
        expect(parseIplayerState('<script>__IPLAYER_REDUX_STATE__ = {broken};</script>')).toBeUndefined();
    });

    it('categoryRails turns group bundles into rails and skips empty or failed ones', async () => {
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.includes('/iplayer/categories/comedy/featured')) {
                return {
                    data: stateHtml([
                        { id: 'b1', title: { default: 'Panel Shows ' }, journey: { id: 'g1', type: 'group' } },
                        { id: 'b2', title: { default: 'Empty' }, journey: { id: 'g2', type: 'group' } },
                        { id: 'b3', title: { default: 'Broken' }, journey: { id: 'g3', type: 'group' } },
                        { id: 'b4', title: { default: 'Not a group' }, journey: { id: 'x', type: 'brand' } },
                    ]),
                };
            }
            if (url.includes('groups/g1/')) return { data: { group_episodes: { elements: [element('r1')] } } };
            if (url.includes('groups/g2/')) return { data: { group_episodes: { elements: [] } } };
            throw new Error('boom');
        });
        const rails = await browseService.categoryRails('comedy');
        expect(rails).toEqual([{ id: 'b1', title: 'Panel Shows', items: [expect.objectContaining({ pid: 'r1' })] }]);
    });

    it('programme groups episodes into ordered seasons', async () => {
        mockedDetails.getMetadata.mockResolvedValue({
            programme: { type: 'brand', pid: 'b00brand', title: 'Brand', medium_synopsis: 'syn', image: { pid: 'p0img' } },
        } as any);
        mockedDetails.getSeriesEpisodes.mockResolvedValue([
            { id: 'e1', type: 'episode', title: 'e1' },
            { id: 'e2', type: 'episode', title: 'e2' },
            { id: 'e3', type: 'episode', title: 'e3' },
            { id: 's1', type: 'series', title: 'series' },
        ] as any);
        mockedDetails.detailsForEpisodeMetadata.mockResolvedValue([
            { pid: 'e3', title: 'B', series: 2, episode: 1, type: VideoType.TV },
            { pid: 'e2', title: 'B', series: 1, episode: 2, type: VideoType.TV },
            { pid: 'e1', title: 'B', series: 1, episode: 1, type: VideoType.TV },
        ]);
        const result = await browseService.programme('b00brand');
        expect(result.thumbnail).toBe('json-api/thumbnail/p0img.jpg');
        expect(result.seasons.map((s) => s.series)).toEqual([1, 2]);
        expect(result.seasons[0].episodes.map((e) => e.pid)).toEqual(['e1', 'e2']);
        expect(mockedDetails.detailsForEpisodeMetadata.mock.calls[0][0]).toHaveLength(3); // series entry filtered out
    });

    it('programme for an episode opens its brand and lists all episodes', async () => {
        mockedDetails.getMetadata
            .mockResolvedValueOnce({ programme: { type: 'episode', pid: 'b00ep001', title: 'Ep' } } as any)
            .mockResolvedValueOnce({ programme: { type: 'brand', pid: 'b00brand', title: 'The Show' } } as any);
        mockedDetails.findBrandForPid.mockResolvedValue('b00brand');
        mockedDetails.getSeriesEpisodes.mockResolvedValue([{ id: 'e1', type: 'episode', title: 'e1' }] as any);
        mockedDetails.detailsForEpisodeMetadata.mockResolvedValue([
            { pid: 'e1', title: 'The Show', series: 1, episode: 1, type: VideoType.TV },
        ]);
        const result = await browseService.programme('b00ep001');
        expect(result).toMatchObject({ pid: 'b00brand', kind: 'brand', title: 'The Show' });
        expect(mockedDetails.getSeriesEpisodes).toHaveBeenCalledWith('b00brand');
    });

    it('programme for a single episode wraps just that episode', async () => {
        mockedDetails.getMetadata.mockResolvedValue({
            programme: { type: 'episode', pid: 'b00ep001', title: 'Ep' },
        } as any);
        mockedDetails.findBrandForPid.mockResolvedValue(undefined);
        mockedDetails.details.mockResolvedValue([{ pid: 'b00ep001', title: 'Ep', type: VideoType.TV }]);
        const result = await browseService.programme('b00ep001');
        expect(result.seasons).toEqual([{ series: undefined, episodes: [expect.objectContaining({ pid: 'b00ep001' })] }]);
        expect(mockedDetails.getSeriesEpisodes).not.toHaveBeenCalled();
    });
});
