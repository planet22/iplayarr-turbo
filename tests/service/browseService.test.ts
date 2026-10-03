import axios from 'axios';

import browseService, { extractElements, toBrowseItem, toBrowseItems } from '../../src/service/browseService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { VideoType } from '../../src/types/IPlayerSearchResult';

jest.mock('axios');
jest.mock('../../src/service/iplayerDetailsService');
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

    it('home returns non-empty rails and drops failed ones', async () => {
        mockedAxios.get
            .mockResolvedValueOnce({ data: { home_highlights: { elements: [element('h1')] } } })
            .mockRejectedValueOnce(new Error('boom'));
        const rails = await browseService.home();
        expect(rails).toHaveLength(1);
        expect(rails[0].id).toBe('highlights');
        expect(rails[0].items[0].pid).toBe('h1');
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

    it('channel returns the known channel plus rails', async () => {
        mockedAxios.get
            .mockResolvedValueOnce({ data: { channel_programmes: { elements: [element('p1')] } } })
            .mockResolvedValueOnce({ data: { channel_highlights: { elements: [element('f1')] } } });
        const result = await browseService.channel('bbc_one');
        expect(result.channel?.title).toBe('BBC One');
        expect(result.rails.map((r) => r.id)).toEqual(['highlights', 'programmes']);
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

    it('programme for a single episode wraps just that episode', async () => {
        mockedDetails.getMetadata.mockResolvedValue({
            programme: { type: 'episode', pid: 'b00ep001', title: 'Ep' },
        } as any);
        mockedDetails.details.mockResolvedValue([{ pid: 'b00ep001', title: 'Ep', type: VideoType.TV }]);
        const result = await browseService.programme('b00ep001');
        expect(result.seasons).toEqual([{ series: undefined, episodes: [expect.objectContaining({ pid: 'b00ep001' })] }]);
        expect(mockedDetails.getSeriesEpisodes).not.toHaveBeenCalled();
    });
});
