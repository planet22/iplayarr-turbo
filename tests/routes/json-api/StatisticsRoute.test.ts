import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/StatisticsRoute'; // adjust path as needed
import statisticsService from '../../../src/service/stats/StatisticsService';

jest.mock('../../../src/service/stats/StatisticsService');

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

    describe('GET /searchHistory?compact=true', () => {
        it('keeps only the title and pid of each result and drops the trace', async () => {
            (statisticsService.getSearchHistory as jest.Mock).mockReturnValue([
                { term: 'a', time: 1, items: [{ title: 'T', pid: 'p1', type: 'TV', size: 5 }], trace: { candidates: [] } },
            ]);

            const res = await request(expressApp).get('/searchHistory?compact=true');
            expect(res.body).toEqual([{ term: 'a', time: 1, items: [{ title: 'T', pid: 'p1' }] }]);
        });
    });

    describe('GET /searchHistory?compact=true edge cases', () => {
        it('keeps entries without results as they are and combines with filterRss and limit', async () => {
            (statisticsService.getSearchHistory as jest.Mock).mockReturnValue([
                { term: '*', time: 1 },
                { term: 'a', time: 2 },
                { term: 'b', time: 3, items: [{ title: 'B', pid: 'p2', type: 'TV' }] },
            ]);

            const res = await request(expressApp).get('/searchHistory?compact=true&filterRss=true&limit=2');
            expect(res.body).toEqual([{ term: 'a', time: 2 }, { term: 'b', time: 3, items: [{ title: 'B', pid: 'p2' }] }]);
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