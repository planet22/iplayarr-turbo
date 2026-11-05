import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/StatisticsRoute'; // adjust path as needed
import appService from '../../../src/service/appService';
import statisticsService from '../../../src/service/stats/StatisticsService';

jest.mock('../../../src/service/stats/StatisticsService');
jest.mock('../../../src/service/appService');

const expressApp = express();
expressApp.use(express.json());
expressApp.use('/', router);

describe('Statistics Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /searchHistory', () => {
        it('returns search history', async () => {
            const history = ['search1', 'search2'];
            (statisticsService.getSearchHistory as jest.Mock).mockReturnValue(history);

            const res = await request(expressApp).get('/searchHistory');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(history);
        });

        it('returns limited search history', async () => {
            const history = ['search1', 'search2'];
            (statisticsService.getSearchHistory as jest.Mock).mockReturnValue(history);

            const res = await request(expressApp).get('/searchHistory?limit=1');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([history[1]]);
        });

        it('returns filtered search history', async () => {
            const filteredHistory = [{ 'term': 'search1' }, { 'term': 'search2' }]
            const history = [...filteredHistory, { 'term': '*' }];
            (statisticsService.getSearchHistory as jest.Mock).mockReturnValue(history);

            const unfilteredRes = await request(expressApp).get('/searchHistory');
            expect(unfilteredRes.status).toBe(200);
            expect(unfilteredRes.body).toEqual(history);

            const filteredRes = await request(expressApp).get('/searchHistory?filterRss=true');
            expect(filteredRes.status).toBe(200);
            expect(filteredRes.body).toEqual(filteredHistory);
        });
    });

    describe('GET /summary', () => {
        const now = Date.now();
        beforeEach(() => {
            (statisticsService.getSearchHistory as jest.Mock).mockResolvedValue([
                { term: 'a', time: now, appId: 'app1', items: [{ title: 'Show', pid: 'p1' }] },
                { term: '*', time: now },
            ]);
            (statisticsService.getGrabHistory as jest.Mock).mockResolvedValue([{ time: now, type: 'TV', nzbName: 'n1', pid: 'p1', appId: 'app1' }]);
            (statisticsService.getFailedGrabHistory as jest.Mock).mockResolvedValue([]);
            (appService.getAllApps as jest.Mock).mockResolvedValue([{ id: 'app1', name: 'Sonarr' }]);
        });

        it('answers the figures the page draws, excluding RSS by default', async () => {
            const res = await request(expressApp).get('/summary');
            expect(res.status).toBe(200);
            expect(res.body.searchTerms).toEqual({ a: 1 });
            expect(res.body.searchSources).toEqual({ Sonarr: 1 });
            expect(res.body.grabSources).toEqual({ Sonarr: 1 });
            expect(res.body.today).toEqual({ searches: 2, grabs: 1, failedGrabs: 0 });
            expect(res.body.topSearched).toEqual([{ title: 'Show', count: 1, pid: 'p1' }]);
        });

        it('uses the range it is given', async () => {
            (statisticsService.getGrabHistory as jest.Mock).mockResolvedValue([{ time: now - 10 * 24 * 60 * 60 * 1000, type: 'TV', nzbName: 'old', pid: 'p' }]);

            expect((await request(expressApp).get('/summary?range=7d')).body.grabTypes).toEqual({});
            expect((await request(expressApp).get('/summary?range=30d')).body.grabTypes).toEqual({ TV: 1 });
            expect((await request(expressApp).get('/summary?range=All')).body.grabTypes).toEqual({ TV: 1 });
        });

        it('includes RSS when asked and falls back to 7 days for an unknown range', async () => {
            const res = await request(expressApp).get('/summary?excludeRss=false&range=bogus');
            expect(res.body.searchTerms).toEqual({ a: 1, 'RSS Feed': 1 });
        });
    });

    describe('GET /searchHistory/detail', () => {
        it('answers the items and trace of one search, empty items when it has none, and 404 when it is not there', async () => {
            (statisticsService.getSearchHistory as jest.Mock).mockResolvedValue([
                { term: 'a', time: 1, items: [{ title: 'T' }], trace: { candidates: [] } },
                { term: 'b', time: 2 },
            ]);

            expect((await request(expressApp).get('/searchHistory/detail?term=a&time=1')).body).toEqual({ items: [{ title: 'T' }], trace: { candidates: [] } });
            expect((await request(expressApp).get('/searchHistory/detail?term=b&time=2')).body).toEqual({ items: [] });
            expect((await request(expressApp).get('/searchHistory/detail?term=zzz&time=9')).status).toBe(404);
        });
    });

    describe('DELETE /searchHistory/term', () => {
        it('removes the term', async () => {
            const res = await request(expressApp).delete('/searchHistory/term?term=Doctor%20Who');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
            expect(statisticsService.removeSearchTerm).toHaveBeenCalledWith('Doctor Who');
        });

        it('rejects a missing term', async () => {
            const res = await request(expressApp).delete('/searchHistory/term');
            expect(res.status).toBe(400);
            expect(statisticsService.removeSearchTerm).not.toHaveBeenCalled();
        });
    });

    describe('GET /grabHistory', () => {
        it('returns grab history', async () => {
            const history = ['grab1', 'grab2'];
            (statisticsService.getGrabHistory as jest.Mock).mockReturnValue(history);

            const res = await request(expressApp).get('/grabHistory');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(history);
        });

        it('returns limited grab history', async () => {
            const history = ['grab1', 'grab2'];
            (statisticsService.getGrabHistory as jest.Mock).mockReturnValue(history);

            const res = await request(expressApp).get('/grabHistory?limit=1');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([history[1]]);
        });
    });

    describe('GET /uptime', () => {
        it('returns uptime', async () => {
            const uptime = 100;
            (statisticsService.getUptime as jest.Mock).mockReturnValue(uptime);

            const res = await request(expressApp).get('/uptime');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ uptime });
        });
    });
});