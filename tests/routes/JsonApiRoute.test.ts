import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';

import router from '../../src/routes/JsonApiRoute';

// Mock dependencies
jest.mock('../../src/facade/nzbFacade');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/facade/searchFacade');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/releaseService', () => ({ ...jest.requireActual('../../src/service/releaseService'), enqueueRelease: jest.fn(), resolveRelease: jest.fn() }));
jest.mock('../../src/service/searchSettingsService');
jest.mock('../../src/service/stats/StatisticsService');
const mockKnownEpisode = jest.fn();
jest.mock('../../src/service/sounds/soundsApiService', () => ({ __esModule: true, ...jest.requireActual('../../src/service/sounds/soundsApiService'), knownEpisode: (id: string) => mockKnownEpisode(id) }));

import nzbFacade from '../../src/facade/nzbFacade';
import scheduleFacade from '../../src/facade/scheduleFacade';
import searchFacade from '../../src/facade/searchFacade';
import soundsFacade from '../../src/facade/soundsFacade';
import collectionService from '../../src/service/collectionService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { enqueueRelease } from '../../src/service/releaseService';
import searchSettingsService from '../../src/service/searchSettingsService';
import soundsBrowseAdapter from '../../src/service/sounds/soundsBrowseAdapter';
import statisticsService from '../../src/service/stats/StatisticsService';
import { ApiError } from '../../src/types/responses/ApiResponse';
import { searchContext } from '../../src/utils/searchContext';
import { traceCandidate } from '../../src/utils/searchTrace';

const app = express();
app.use(bodyParser.json());
app.use(router);

describe('JsonApiRoute', () => {
    describe('POST /nzb/test', () => {
        it('should return status true on success', async () => {
            (nzbFacade.testConnection as jest.Mock).mockResolvedValue(true);

            const res = await request(app).post('/nzb/test').send({
                NZB_URL: 'http://example.com',
                NZB_API_KEY: 'abc123',
                NZB_TYPE: 'nzbget',
                NZB_USERNAME: 'user',
                NZB_PASSWORD: 'pass'
            });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });

        it('should return 500 with error on failure', async () => {
            (nzbFacade.testConnection as jest.Mock).mockResolvedValue('Connection failed');

            const res = await request(app).post('/nzb/test').send({
                NZB_URL: 'http://example.com',
                NZB_API_KEY: 'abc123',
                NZB_TYPE: 'nzbget',
                NZB_USERNAME: 'user',
                NZB_PASSWORD: 'pass'
            });

            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'Connection failed' });
        });
    });

    describe('unknown endpoints', () => {
        it.each([['GET', '/no-such-endpoint'], ['POST', '/synonym/nope/deeper'], ['DELETE', '/nothing']])('%s %s answers a JSON 404, not the web page', async (method, path) => {
            const res = await (request(app) as any)[method.toLowerCase()](path);
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: ApiError.API_NOT_FOUND, message: 'No such endpoint' });
        });
    });

    describe('GET /search', () => {
        it('answers 400 for a repeated or nested q instead of failing inside the search', async () => {
            const repeated = await request(app).get('/search?q=a&q=b');
            const nested = await request(app).get('/search?q[x]=1');
            expect(repeated.status).toBe(400);
            expect(nested.status).toBe(400);
            expect(searchFacade.search).not.toHaveBeenCalled();
        });

        it('should return search results', async () => {
            const mockResults = [{ title: 'Episode 1', pid: 'b012345' }];
            (searchFacade.search as jest.Mock).mockResolvedValue(mockResults);

            const res = await request(app).get('/search').query({ q: 'test' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockResults);
        });
    });

    describe('manual search context', () => {
        it('runs /search and /search/stream as a manual search', async () => {
            const seen: string[] = [];
            (searchFacade.search as jest.Mock).mockImplementation(async () => {
                seen.push(searchContext());
                return [];
            });
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async () => {
                seen.push(searchContext());
                return [];
            });
            await request(app).get('/search').query({ q: 'test' });
            await request(app).get('/search/stream').query({ q: 'test' });
            expect(seen).toEqual(['manual', 'manual']);
        });

        it('records manual searches in the search history, without an app', async () => {
            (statisticsService.addSearch as jest.Mock).mockResolvedValue(undefined);
            (searchFacade.search as jest.Mock).mockResolvedValue([{ title: 'Doc', nzbName: 'Doc.S01', type: 'TV', pid: 'p01abc', size: 5 }]);
            (searchFacade.searchStreaming as jest.Mock).mockResolvedValue([]);

            await request(app).get('/search').query({ q: 'doc' });
            await request(app).get('/search/stream').query({ q: 'bake' });
            await request(app).get('/search').query({ q: '*' });

            expect(statisticsService.addSearch).toHaveBeenCalledTimes(2);
            expect(statisticsService.addSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
                term: 'doc',
                results: 1,
                source: 'manual',
                items: [expect.objectContaining({ title: 'Doc.S01', pid: 'p01abc' })],
            }));
            expect((statisticsService.addSearch as jest.Mock).mock.calls[0][0].appId).toBeUndefined();
            expect((statisticsService.addSearch as jest.Mock).mock.calls[0][0]).not.toHaveProperty('kind');
            expect(statisticsService.addSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({ term: 'bake', results: 0 }));
        });

        it('records only the dropped candidates, and a failure to record never fails the search', async () => {
            (searchFacade.search as jest.Mock).mockImplementation(async () => {
                traceCandidate({ title: 'dropped', stage: 'episode', kept: false, reason: 'wrong-season' });
                traceCandidate({ title: 'kept', stage: 'episode', kept: true });
                return [];
            });
            (statisticsService.addSearch as jest.Mock).mockResolvedValueOnce(undefined);
            await request(app).get('/search').query({ q: 'trace' }).expect(200);
            await new Promise((resolve) => setImmediate(resolve));
            expect((statisticsService.addSearch as jest.Mock).mock.calls.at(-1)[0].trace.candidates.map(({ title }: any) => title)).toEqual(['dropped']);

            (statisticsService.addSearch as jest.Mock).mockRejectedValueOnce(new Error('db locked'));
            await request(app).get('/search').query({ q: 'trace again' }).expect(200);
        });

        it('GET /search/settings describes the manual setup', async () => {
            const state = { native: true, engine: 'V2', matchAllWords: true, inherited: [] };
            (searchSettingsService.effective as jest.Mock).mockResolvedValue(state);
            const res = await request(app).get('/search/settings');
            expect(res.body).toEqual(state);
            expect(searchSettingsService.effective).toHaveBeenCalledWith('manual');
        });

        it('GET /search/settings?mode=radio describes the radio setup, and is 404 while BBC Sounds is off', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            const res = await request(app).get('/search/settings').query({ mode: 'radio' });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ radio: true, rankByTitle: true, scope: 'both', mp3Only: false, networks: [], maxResults: 0 });
            expect(searchSettingsService.effective).not.toHaveBeenCalled();
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(false);
            expect((await request(app).get('/search/settings').query({ mode: 'radio' })).status).toBe(404);
        });
    });

    describe('versions on manual search results', () => {
        const metadataFor = async (pid: string) => ({
            programme: {
                versions:
                    pid === 'p1'
                        ? [{ pid: 'o', types: ['Original version'] }, { pid: 'a', types: ['Dubbed Audio Described'] }, { pid: 's', types: ['Signed'] }]
                        : [{ pid: 'o2', types: ['Original version'] }],
            },
        });

        beforeEach(() => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockImplementation(metadataFor);
            (statisticsService.addSearch as jest.Mock).mockResolvedValue(undefined);
        });

        it('marks /search results with the audio described and signed versions their programme has', async () => {
            (searchFacade.search as jest.Mock).mockResolvedValue([
                { pid: 'p1', title: 'One', type: 'TV' },
                { pid: 'p2', title: 'Two', type: 'TV' },
            ]);
            const res = await request(app).get('/search').query({ q: 'x' });
            expect(res.body[0].versions).toEqual(['audio-described', 'signed']);
            expect(res.body[1]).not.toHaveProperty('versions');
        });

        it('marks each /search/stream batch before sending it, in order, and still finishes with done', async () => {
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async (_q: string, onBatch: (batch: unknown[]) => void) => {
                onBatch([{ pid: 'p1', title: 'One', type: 'TV' }]);
                onBatch([{ pid: 'p2', title: 'Two', type: 'TV' }]);
                return [];
            });
            const res = await request(app).get('/search/stream').query({ q: 'x' });
            const lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(lines).toHaveLength(3);
            expect(lines[0][0]).toMatchObject({ pid: 'p1', versions: ['audio-described', 'signed'] });
            expect(lines[1][0].pid).toBe('p2');
            expect(lines[1][0]).not.toHaveProperty('versions');
            expect(lines[2]).toEqual({ done: true });
        });

        it('sends the collections that match as their own /search/stream line, before done', async () => {
            const found = [{ id: 'p096h09x', title: 'Fright Night', count: 34 }];
            const spy = jest.spyOn(collectionService, 'matchesForSearch').mockResolvedValue(found);
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async (_q: string, onBatch: (batch: unknown[]) => void) => {
                onBatch([{ pid: 'p1', title: 'One', type: 'TV' }]);
                return [];
            });
            const res = await request(app).get('/search/stream').query({ q: 'fright night' });
            const lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(spy).toHaveBeenCalledWith('fright night', 6);
            expect(lines).toContainEqual({ collections: found });
            expect(lines[lines.length - 1]).toEqual({ done: true });
            spy.mockRestore();
        });

        it('sends a note before done when BBC answered but every hit was dropped for the title', async () => {
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async () => {
                traceCandidate({ title: 'BBC returned the maximum 24 hits', stage: 'bbc', kept: false, reason: 'hit-cap' });
                traceCandidate({ title: 'Go Jetters', stage: 'bbc', kept: false, reason: 'no-match' });
                traceCandidate({ title: 'Nadiya Bakes', stage: 'bbc', kept: false, reason: 'missing-word' });
                return [];
            });
            const res = await request(app).get('/search/stream').query({ q: 'choc' });
            const lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(lines).toEqual([{ note: { dropped: 2, capped: true } }, { done: true }]);
        });

        it('sends no note when there are results, or when nothing was dropped', async () => {
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async () => {
                traceCandidate({ title: 'x', stage: 'bbc', kept: false, reason: 'no-match' });
                return [{ pid: 'p1', title: 'One', type: 'TV' }];
            });
            let res = await request(app).get('/search/stream').query({ q: 'x' });
            expect(res.text).not.toContain('"note"');
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async () => []);
            res = await request(app).get('/search/stream').query({ q: 'x' });
            expect(res.text).not.toContain('"note"');
        });

        it('records a BBC Sounds search as a manual radio one, so it reads as Radio even with no results', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockResolvedValue({ shows: [], episodes: [] });
            await request(app).get('/search').query({ q: 'nothing here', mode: 'radio' });
            await request(app).get('/search/stream').query({ q: 'nor here', mode: 'radio' });
            await new Promise((resolve) => setImmediate(resolve));
            const recorded = (statisticsService.addSearch as jest.Mock).mock.calls.map(([entry]) => entry);
            expect(recorded.map(({ term }) => term)).toEqual(['nothing here', 'nor here']);
            recorded.forEach((entry) => expect(entry).toMatchObject({ source: 'manual', kind: 'radio', results: 0 }));
        });

        it('records radio hits under their show and episode name with their network, as the results popup lists them', async () => {
            (statisticsService.addSearch as jest.Mock).mockClear();
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockResolvedValue({
                shows: [{ id: 'b1', title: 'The Archers', network: 'Radio 4' }],
                episodes: [
                    { id: 'e1', title: 'The Archers', showTitle: 'The Archers', subtitle: 'Omnibus', network: 'Radio 4 Extra', mp3: true },
                    { id: 'e2', title: 'Lonely Episode', mp3: false },
                ],
            });
            await request(app).get('/search').query({ q: 'archers', mode: 'radio' });
            await new Promise((resolve) => setImmediate(resolve));
            const [[entry]] = (statisticsService.addSearch as jest.Mock).mock.calls;
            expect(entry.items.map(({ title, channel, type, pid }: any) => ({ title, channel, type, pid }))).toEqual([
                { title: 'The Archers', channel: 'Radio 4', type: 'RADIO', pid: 'b1' },
                { title: 'The Archers - Omnibus', channel: 'Radio 4 Extra', type: 'RADIO', pid: 'e1' },
                { title: 'Lonely Episode', channel: undefined, type: 'RADIO', pid: 'e2' },
            ]);
        });

        it('records why a radio search dropped hits, but only the dropped ones, in the stored trace', async () => {
            (statisticsService.addSearch as jest.Mock).mockClear();
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockImplementation(async () => {
                traceCandidate({ title: 'Gardeners Question Time', stage: 'bbc', kept: false, reason: 'missing-word', detail: '\'archers\' is not in the title' });
                traceCandidate({ title: 'The Archers', stage: 'bbc', kept: true });
                return { shows: [{ id: 'b1', title: 'The Archers' }], episodes: [] };
            });
            await request(app).get('/search/stream').query({ q: 'archers', mode: 'radio' });
            await new Promise((resolve) => setImmediate(resolve));
            const [[entry]] = (statisticsService.addSearch as jest.Mock).mock.calls;
            expect(entry.trace.candidates).toEqual([{ title: 'Gardeners Question Time', stage: 'bbc', kept: false, reason: 'missing-word', detail: '\'archers\' is not in the title' }]);
            expect(entry).toMatchObject({ kind: 'radio', source: 'manual', results: 1 });
        });

        it('says how many radio hits were dropped when nothing is left, as the video search does', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockImplementation(async () => {
                traceCandidate({ title: 'Gardeners Question Time', stage: 'bbc', kept: false, reason: 'missing-word', detail: '\'archers\' is not in the title' });
                return { shows: [], episodes: [] };
            });
            const res = await request(app).get('/search/stream').query({ q: 'archers', mode: 'radio' });
            const lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(lines).toEqual([[], { note: { dropped: 1, capped: false } }, { done: true }]);
        });

        it('answers ?mode=radio from BBC Sounds as the same lines, without running the video search', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockResolvedValue({ shows: [{ id: 'b1', title: 'The Archers' }], episodes: [] });
            const res = await request(app).get('/search/stream').query({ q: 'archers', mode: 'radio' });
            const lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(lines[0]).toEqual([expect.objectContaining({ pid: 'b1', radio: true, kind: 'brand', title: 'The Archers' })]);
            expect(lines[1]).toEqual({ done: true });
            expect(res.headers['content-type']).toContain('application/x-ndjson');
            expect(searchFacade.searchStreaming).not.toHaveBeenCalled();
        });

        it('sends radio collections that match as their own line before the results, then done', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockResolvedValue({ shows: [{ id: 'b1', title: 'Football Focus' }], episodes: [] });
            const found = [{ id: 'c1', title: 'Football Specials', count: 4 }];
            const spy = jest.spyOn(soundsBrowseAdapter, 'collectionsForSearch').mockResolvedValue(found);
            const res = await request(app).get('/search/stream').query({ q: 'football', mode: 'radio' });
            const lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(spy).toHaveBeenCalledWith('football', 6);
            expect(lines[0]).toEqual({ collections: found });
            expect(lines[1]).toEqual([expect.objectContaining({ pid: 'b1', radio: true })]);
            expect(lines[2]).toEqual({ done: true });
            spy.mockRestore();
        });

        it('sends no collections line for radio when none match, and still searches when the lookup fails', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockResolvedValue({ shows: [{ id: 'b1', title: 'Football Focus' }], episodes: [] });
            const spy = jest.spyOn(soundsBrowseAdapter, 'collectionsForSearch').mockResolvedValueOnce([]);
            let res = await request(app).get('/search/stream').query({ q: 'football', mode: 'radio' });
            let lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(lines.some((line) => line.collections)).toBe(false);
            expect(lines[lines.length - 1]).toEqual({ done: true });
            spy.mockRejectedValueOnce(new Error('sounds down'));
            res = await request(app).get('/search/stream').query({ q: 'football', mode: 'radio' });
            lines = res.text.trim().split('\n').map((line) => JSON.parse(line));
            expect(lines.some((line) => line.collections)).toBe(false);
            expect(lines[0]).toEqual([expect.objectContaining({ pid: 'b1' })]);
            spy.mockRestore();
        });

        it('does not ask for radio collections on a video search', async () => {
            const spy = jest.spyOn(soundsBrowseAdapter, 'collectionsForSearch');
            (searchFacade.searchStreaming as jest.Mock).mockResolvedValue([]);
            await request(app).get('/search/stream').query({ q: 'football' });
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it('answers GET /search?mode=radio with the Sounds results in one reply, and 404 while BBC Sounds is off', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockResolvedValue({ shows: [{ id: 'b1', title: 'The Archers' }], episodes: [] });
            (searchFacade.search as jest.Mock).mockClear();
            const res = await request(app).get('/search').query({ q: 'archers', mode: 'radio' });
            expect(res.status).toBe(200);
            expect(res.body).toEqual([expect.objectContaining({ pid: 'b1', radio: true, kind: 'brand' })]);
            expect(searchFacade.search).not.toHaveBeenCalled();
            jest.spyOn(soundsFacade, 'search').mockRejectedValue(new Error('down'));
            expect((await request(app).get('/search').query({ q: 'x', mode: 'radio' })).status).toBeGreaterThanOrEqual(500);
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(false);
            expect((await request(app).get('/search').query({ q: 'x', mode: 'radio' })).status).toBe(404);
        });

        it('reports a Sounds failure as an error line, and is 404 while BBC Sounds is off', async () => {
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(true);
            jest.spyOn(soundsFacade, 'search').mockRejectedValue(new Error('down'));
            const failed = await request(app).get('/search/stream').query({ q: 'x', mode: 'radio' });
            expect(JSON.parse(failed.text.trim())).toEqual({ error: 'down' });
            jest.spyOn(soundsFacade, 'isEnabled').mockResolvedValue(false);
            expect((await request(app).get('/search/stream').query({ q: 'x', mode: 'radio' })).status).toBe(404);
            expect((await request(app).get('/search/stream').query({ q: ' ', mode: 'radio' })).status).toBe(400);
        });

        it('still streams the results when the collections cannot be looked up', async () => {
            const spy = jest.spyOn(collectionService, 'matchesForSearch').mockRejectedValue(new Error('down'));
            (searchFacade.searchStreaming as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/search/stream').query({ q: 'x' });
            expect(res.text.trim()).toBe(JSON.stringify({ done: true }));
            spy.mockRestore();
        });

        it('still returns the results when BBC cannot be asked about versions', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockRejectedValue(new Error('down'));
            (searchFacade.search as jest.Mock).mockResolvedValue([{ pid: 'p1', title: 'One', type: 'TV' }]);
            const res = await request(app).get('/search').query({ q: 'x' });
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ pid: 'p1', title: 'One', type: 'TV' }]);
        });
    });

    describe('GET /details', () => {
        it('should return episode details', async () => {
            const mockDetails = [{ title: 'Test Show', pid: 'p01abc' }];
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue(mockDetails);

            const res = await request(app).get('/details').query({ pid: 'p01abc' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockDetails[0]);
        });

        it('shapes a known radio episode like a video\'s details', async () => {
            mockKnownEpisode.mockReturnValue({ id: 'm0033frv', title: 'Newsbeat', showTitle: 'Radio 1 Newsbeat', subtitle: '06/11/2026', network: 'BBC Radio 1', synopsis: 'News', duration: 600, released: '2026-11-06', image: 'https://ichef.bbci.co.uk/images/ic/x/y.jpg' });
            const res = await request(app).get('/details').query({ pid: 'm0033frv', kind: 'radio' });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ pid: 'm0033frv', title: 'Radio 1 Newsbeat', episodeTitle: '06/11/2026', channel: 'BBC Radio 1', description: 'News', runtime: 10, firstBroadcast: '2026-11-06', type: 'RADIO', category: 'Radio' });
            expect(iplayerDetailsService.details).not.toHaveBeenCalled();
        });

        it('answers a bare radio record for an episode no longer known', async () => {
            mockKnownEpisode.mockReturnValue(undefined);
            (iplayerDetailsService.radioDetails as jest.Mock).mockResolvedValue(undefined);
            const res = await request(app).get('/details').query({ pid: 'm0033frv', kind: 'radio' });
            expect(res.body).toMatchObject({ pid: 'm0033frv', category: 'Radio', type: 'RADIO' });
        });

        it('refuses an odd radio episode id', async () => {
            const res = await request(app).get('/details').query({ pid: 'not valid!', kind: 'radio' });
            expect(res.status).toBe(400);
            expect(iplayerDetailsService.radioDetails).not.toHaveBeenCalled();
        });

        it('leaves out the optional radio fields an episode does not have', async () => {
            mockKnownEpisode.mockReturnValue({ id: 'm0033frv', title: 'Newsbeat' });
            const res = await request(app).get('/details').query({ pid: 'm0033frv', kind: 'radio' });
            expect(res.body).toMatchObject({ title: 'Newsbeat', category: 'Radio', link: 'https://www.bbc.co.uk/sounds/play/m0033frv' });
            expect(res.body.runtime).toBeUndefined();
            expect(res.body.episodeTitle).toBeUndefined();
        });

        it('asks BBC\'s programme page for a radio episode that is no longer known', async () => {
            mockKnownEpisode.mockReturnValue(undefined);
            (iplayerDetailsService.radioDetails as jest.Mock).mockResolvedValue({ pid: 'p0nyk2n0', title: 'Dwayne Johnson - Rock and Roll', type: 'RADIO' });
            const res = await request(app).get('/details').query({ pid: 'p0nyk2n0', kind: 'radio' });
            expect(res.body).toMatchObject({ pid: 'p0nyk2n0', title: 'Dwayne Johnson - Rock and Roll' });
        });
    });

    describe('GET /download', () => {
        it('should queue the programme through the release resolver and return success', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});

            const res = await request(app).get('/download').query({ pid: 'p01xyz' });

            // No name or type sent: the plain name, and the type from the BBC's format category; nothing to fall back on.
            expect(enqueueRelease).toHaveBeenCalledWith('p01xyz', {
                version: undefined,
                quality: undefined,
                nameOverride: undefined,
                type: undefined,
                typeFrom: 'category',
                nameStyle: 'plain',
                numberingFromName: undefined,
                fallback: undefined,
                mediaMode: undefined,
            });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });

        it('passes a per-download media mode through and rejects an unknown one', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});

            for (const media of ['strm', 'download']) {
                await request(app).get('/download').query({ pid: 'p01xyz', media }).expect(200);
                expect(enqueueRelease).toHaveBeenLastCalledWith('p01xyz', expect.objectContaining({ mediaMode: media }));
            }

            (enqueueRelease as jest.Mock).mockClear();
            const bad = await request(app).get('/download').query({ pid: 'p01xyz', media: 'bogus' });
            expect(bad.status).toBe(400);
            expect(enqueueRelease).not.toHaveBeenCalled();
        });

        it('passes a chosen version and quality to the resolver', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});
            await request(app).get('/download').query({ pid: 'p01xyz', version: 'audio-described', quality: 'sd' }).expect(200);
            expect(enqueueRelease).toHaveBeenCalledWith('p01xyz', expect.objectContaining({ version: 'audio-described', quality: 'sd' }));
        });
    });

    describe('GET /programme-versions', () => {
        it('lists the audio described and signed versions a programme has', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({
                programme: { versions: [{ pid: 'o', types: ['Original version'] }, { pid: 'a', types: ['Dubbed Audio Described'] }] },
            });
            const res = await request(app).get('/programme-versions').query({ pid: 'p01xyz' });
            expect(res.status).toBe(200);
            expect(res.body.map(({ id }: any) => id)).toEqual(['audio-described']);
        });

        it('is empty when BBC cannot be asked, and rejects a bad pid', async () => {
            (iplayerDetailsService.getMetadata as jest.Mock).mockRejectedValue(new Error('down'));
            expect((await request(app).get('/programme-versions').query({ pid: 'p01xyz' })).body).toEqual([]);
            expect((await request(app).get('/programme-versions').query({ pid: '../x' })).status).toBe(400);
        });
    });

    describe('GET /cache-refresh', () => {
        it('should trigger cache refresh and return success', async () => {
            const refreshCacheMock = scheduleFacade.refreshCache as jest.Mock;
            refreshCacheMock.mockImplementation(() => { });

            const res = await request(app).get('/cache-refresh');

            expect(refreshCacheMock).toHaveBeenCalled();
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });
    });
});
