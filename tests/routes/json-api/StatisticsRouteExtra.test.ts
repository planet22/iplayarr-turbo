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
