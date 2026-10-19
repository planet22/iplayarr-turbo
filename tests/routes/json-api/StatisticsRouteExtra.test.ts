import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/StatisticsRoute';
import statisticsService from '../../../src/service/stats/StatisticsService';

jest.mock('../../../src/service/stats/StatisticsService');
const mocked = jest.mocked(statisticsService);

const app = express();
app.use('/', router);

describe('Statistics Routes (clear + failed history)', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        ['/searchHistory', 'clearSearchHistory'],
        ['/grabHistory', 'clearGrabHistory'],
        ['/failedGrabHistory', 'clearFailedGrabHistory'],
    ] as const)('DELETE %s clears', async (path, method) => {
        const res = await request(app).delete(path);
        expect(mocked[method]).toHaveBeenCalled();
        expect(res.body).toEqual({ status: true });
    });

    it('GET /failedGrabHistory returns all and limited', async () => {
        (mocked.getFailedGrabHistory as jest.Mock).mockResolvedValue(['a', 'b', 'c']);
        expect((await request(app).get('/failedGrabHistory')).body).toEqual(['a', 'b', 'c']);
        expect((await request(app).get('/failedGrabHistory?limit=2')).body).toEqual(['b', 'c']);
    });

    it('GET /grabHistory limits', async () => {
        (mocked.getGrabHistory as jest.Mock).mockResolvedValue(['a', 'b']);
        expect((await request(app).get('/grabHistory?limit=1')).body).toEqual(['b']);
    });
});

describe('searchHistory summary and detail', () => {
    const entry = { term: 'a', time: 5, results: 1, items: [{ title: 't', type: 'TV', pid: 'p' }], trace: { candidates: [] } };

    it('strips items and trace in summary mode', async () => {
        (mocked.getSearchHistory as jest.Mock).mockReturnValue([entry]);
        const res = await request(app).get('/searchHistory?summary=true');
        expect(res.body).toEqual([{ term: 'a', time: 5, results: 1, type: 'TV', hasDetail: true, filteredOut: 0 }]);
    });

    it('counts filtered-out candidates in summary mode', async () => {
        const dropped = { ...entry, trace: { truncated: true, candidates: [{ title: 'x', stage: 'bbc', kept: false }, { title: 'y', stage: 'bbc', kept: true }] } };
        (mocked.getSearchHistory as jest.Mock).mockReturnValue([dropped]);
        const res = await request(app).get('/searchHistory?summary=true');
        expect(res.body[0]).toMatchObject({ filteredOut: 1, truncated: true });
    });

    it('returns detail for a search, 404 when unknown', async () => {
        (mocked.getSearchHistory as jest.Mock).mockReturnValue([entry]);
        const ok = await request(app).get('/searchHistory/detail?term=a&time=5');
        expect(ok.body).toEqual({ items: entry.items, trace: entry.trace });
        const missing = await request(app).get('/searchHistory/detail?term=b&time=5');
        expect(missing.status).toBe(404);
    });
});
