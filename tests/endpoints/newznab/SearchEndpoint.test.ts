import { Request, Response } from 'express';
import { parseStringPromise } from 'xml2js';

import SearchEndpoint from '../../../src/endpoints/newznab/SearchEndpoint';
import searchFacade from '../../../src/facade/searchFacade';
import appService from '../../../src/service/appService';
import configService from '../../../src/service/configService';
import statisticsService from '../../../src/service/stats/StatisticsService';
import * as versionVpid from '../../../src/service/stream/versionVpid';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { VideoType } from '../../../src/types/IPlayerSearchResult';
import { traceCandidate } from '../../../src/utils/searchTrace';
import * as Utils from '../../../src/utils/Utils';

jest.mock('../../../src/facade/searchFacade');
jest.mock('../../../src/service/appService');
jest.mock('../../../src/service/stats/StatisticsService');
jest.spyOn(Utils, 'getBaseUrl').mockReturnValue('http://localhost:3000');
jest.spyOn(Utils, 'createNZBDownloadLink').mockImplementation(() => Promise.resolve('/nzb/link.nzb'));

describe('SearchEndpoint', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let sendMock: jest.Mock;
    let setMock: jest.Mock;

    beforeEach(() => {
        sendMock = jest.fn();
        setMock = jest.fn();
        req = {
            query: {
                q: 'Test Show',
                season: '1',
                ep: '2',
                cat: '5000,5040',
                app: 'radarr',
                apikey: 'mockkey',
            },
            headers: {},
        };
        res = {
            set: setMock,
            send: sendMock,
        };
    });

    it('responds with valid XML and logs search history', async () => {
        const fakeResults = [
            {
                pid: 'xyz123',
                type: VideoType.TV,
                nzbName: 'Test.Show.S01E02.720p',
                size: 1500,
                pubDate: new Date(),
            },
        ];

        (searchFacade.search as jest.Mock).mockResolvedValue(fakeResults);
        (statisticsService.addSearch as jest.Mock).mockImplementation(() => { });

        await SearchEndpoint(req as Request, res as Response);

        expect(setMock).toHaveBeenCalledWith('Content-Type', 'application/xml');
        expect(sendMock).toHaveBeenCalled();

        const xml = sendMock.mock.calls[0][0];
        expect(typeof xml).toBe('string');

        const parsed = await parseStringPromise(xml);
        expect(parsed).toHaveProperty('rss');
        expect(parsed.rss).toHaveProperty('channel');
        expect(parsed.rss.channel[0]).toHaveProperty('item');

        expect(searchFacade.search).toHaveBeenCalledWith('Test Show', '1', '2');
        expect(statisticsService.addSearch).toHaveBeenCalledWith({
            term: 'Test Show',
            results: 1,
            appId: 'radarr',
            series: '1',
            episode: '2',
            time: expect.any(Number),
            items: [
                {
                    title: 'Test.Show.S01E02.720p',
                    type: VideoType.TV,
                    size: 1500,
                    pubDate: fakeResults[0].pubDate,
                    pid: 'xyz123',
                },
            ],
            trace: { candidates: [] },
        });
    });

    it('adds no version variants while EXTRA_VERSIONS is empty', async () => {
        const lookup = jest.spyOn(versionVpid, 'versionTypesFor');
        (searchFacade.search as jest.Mock).mockResolvedValue([{ pid: 'xyz123', type: VideoType.TV, nzbName: 'Test.Show.S01E02.WEBDL.720p-BBC', size: 1500 }]);

        await SearchEndpoint(req as Request, res as Response);

        const parsed = await parseStringPromise(sendMock.mock.calls[0][0]);
        expect(parsed.rss.channel[0].item).toHaveLength(1);
        expect(lookup).not.toHaveBeenCalled();
        lookup.mockRestore();
    });

    it('offers an audio described variant, with its own tag and guid, when enabled and the programme has one', async () => {
        await configService.setParameter(IplayarrParameter.EXTRA_VERSIONS, 'audio-described');
        const lookup = jest.spyOn(versionVpid, 'versionTypesFor').mockResolvedValue([{ pid: 'o', types: ['Original version'] }, { pid: 'a', types: ['Dubbed Audio Described'] }]);
        (searchFacade.search as jest.Mock).mockResolvedValue([{ pid: 'xyz123', type: VideoType.TV, nzbName: 'Test.Show.S01E02.WEBDL.720p-BBC', size: 1500 }]);

        await SearchEndpoint(req as Request, res as Response);

        const items = (await parseStringPromise(sendMock.mock.calls[0][0])).rss.channel[0].item;
        expect(items.map((i: any) => i.title[0])).toEqual(['Test.Show.S01E02.WEBDL.720p-BBC', 'Test.Show.S01E02.AUDIO.DESCRIBED.WEBDL.540p-BBC']);
        expect(items.map((i: any) => i.guid[0])).toEqual(['https://www.bbc.co.uk/iplayer/episodes/xyz123', 'https://www.bbc.co.uk/iplayer/episodes/xyz123#audio-described']);
        expect(Utils.createNZBDownloadLink).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ version: 'audio-described', quality: 'sd' }), 'mockkey', 'radarr');
        lookup.mockRestore();
        await configService.setParameter(IplayarrParameter.EXTRA_VERSIONS, '');
    });

    it('falls back to matching the User-Agent header when app is not supplied', async () => {
        (req.query as any).app = undefined;
        req.headers = { 'user-agent': 'Sonarr/4.0.0.0 (linux)' };

        (searchFacade.search as jest.Mock).mockResolvedValue([]);
        (statisticsService.addSearch as jest.Mock).mockImplementation(() => { });
        (appService.findAppByUserAgent as jest.Mock).mockResolvedValue({ id: 'sonarr-id' });

        await SearchEndpoint(req as Request, res as Response);

        expect(appService.findAppByUserAgent).toHaveBeenCalledWith('Sonarr/4.0.0.0 (linux)');
        expect(statisticsService.addSearch).toHaveBeenCalledWith(
            expect.objectContaining({ appId: 'sonarr-id' })
        );
    });

    it('touches the app when an app ID is supplied in the query', async () => {
        (searchFacade.search as jest.Mock).mockResolvedValue([]);

        await SearchEndpoint(req as Request, res as Response);

        expect(appService.touchApp).toHaveBeenCalledWith('radarr');
    });

    it('does not touch an app directly when resolving by User-Agent', async () => {
        (req.query as any).app = undefined;
        req.headers = { 'user-agent': 'Sonarr/4.0.0.0 (linux)' };
        (searchFacade.search as jest.Mock).mockResolvedValue([]);
        (appService.findAppByUserAgent as jest.Mock).mockResolvedValue({ id: 'sonarr-id' });
        (appService.touchApp as jest.Mock).mockClear();

        await SearchEndpoint(req as Request, res as Response);

        expect(appService.touchApp).not.toHaveBeenCalled();
    });

    describe('branches', () => {
        const run = async (query: object, results: object[]) => {
            (searchFacade.search as jest.Mock).mockResolvedValue(results);
            (statisticsService.addSearch as jest.Mock).mockImplementation(() => { });
            (appService.findAppByUserAgent as jest.Mock).mockResolvedValue(undefined);
            const request = { query: { apikey: 'k', ...query }, headers: {} } as unknown as Request;
            await SearchEndpoint(request, res as Response);
            return parseStringPromise(sendMock.mock.calls[0][0]);
        };
        const item = (over: object = {}) => ({ pid: 'p1', type: VideoType.TV, nzbName: 'Show.S01E01', title: 'Show', size: 100, pubDate: new Date('2024-01-02T10:00:00Z'), ...over });

        it('searches everything when no term is given, and records no trace for it', async () => {
            await run({}, [item()]);
            expect(searchFacade.search).toHaveBeenCalledWith('*', undefined, undefined);
            expect((statisticsService.addSearch as jest.Mock).mock.calls[0][0]).toMatchObject({ term: '*', trace: undefined });
        });

        it('records only the dropped candidates of a search for a term', async () => {
            await run({ q: 'show' }, [item()]);
            const entry = (statisticsService.addSearch as jest.Mock).mock.calls[0][0];
            expect(entry.term).toBe('show');
            expect(entry.trace).toBeDefined();
            expect(entry.trace.candidates.every(({ kept }: any) => !kept)).toBe(true);
        });

        it('keeps only the dropped candidates in the recorded trace', async () => {
            (searchFacade.search as jest.Mock).mockImplementation(async () => {
                traceCandidate({ title: 'dropped', stage: 'episode', kept: false, reason: 'wrong-season' });
                traceCandidate({ title: 'kept', stage: 'episode', kept: true });
                return [item()];
            });
            (statisticsService.addSearch as jest.Mock).mockImplementation(() => { });
            (appService.findAppByUserAgent as jest.Mock).mockResolvedValue(undefined);
            await SearchEndpoint({ query: { apikey: 'k', q: 'show' }, headers: {} } as unknown as Request, res as Response);
            const entry = (statisticsService.addSearch as jest.Mock).mock.calls.at(-1)[0];
            expect(entry.trace.candidates.map(({ title }: any) => title)).toEqual(['dropped']);
        });

        it('names a history item by its title when it has no release name', async () => {
            await run({}, [item({ nzbName: undefined })]);
            expect((statisticsService.addSearch as jest.Mock).mock.calls[0][0].items[0].title).toBe('Show');
        });

        it('sizes a result in bytes, or as 2GB when it has no size', async () => {
            const parsed = await run({}, [item({ size: 2 }), item({ pid: 'p2', size: undefined })]);
            const [sized, unsized] = parsed.rss.channel[0].item;
            expect(sized.size[0]).toBe(String(2 * 1048576));
            expect(sized.enclosure[0].$.length).toBe(String(2 * 1048576));
            expect(unsized.size[0]).toBe('2147483648');
            expect(unsized.enclosure[0].$.length).toBe('2147483648');
        });

        it('dates a result with no air date 12 hours ago', async () => {
            const parsed = await run({}, [item({ pubDate: undefined })]);
            expect(parsed.rss.channel[0].item[0].pubDate[0]).toMatch(/\+0000$/);
        });

        describe('categories', () => {
            it.each([
                [VideoType.MOVIE, ['2000', '2040']],
                [VideoType.TV, ['5000', '5040']],
                [VideoType.UNKNOWN, []],
            ])('lists a %s result under %j', async (type, categories) => {
                const parsed = await run({}, [item({ type })]);
                expect(parsed.rss.channel[0].item[0].category ?? []).toEqual(categories);
            });

            it('keeps only results in a requested category, and none when the category matches nothing', async () => {
                const results = [item({ pid: 'tv', type: VideoType.TV }), item({ pid: 'film', type: VideoType.MOVIE }), item({ pid: 'odd', type: VideoType.UNKNOWN })];
                const films = await run({ cat: '2000' }, results);
                expect(films.rss.channel[0].item).toHaveLength(1);
                sendMock.mockClear();
                const none = await run({ cat: '9999' }, results);
                expect(none.rss.channel[0].item).toBeUndefined();
            });
        });
    });
});
