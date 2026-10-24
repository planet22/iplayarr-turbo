import express from 'express';
import request from 'supertest';

import router, { requestLimiter } from '../../../src/routes/json-api/RequestRoute';
import subscriptionArrService, { SubscriptionArrError } from '../../../src/service/subscriptionArrService';

jest.mock('../../../src/service/subscriptionArrService', () => ({
    __esModule: true,
    SubscriptionArrError: class SubscriptionArrError extends Error {},
    default: { request: jest.fn(), tags: jest.fn(), monitorOptions: jest.fn() },
}));
const mocked = jest.mocked(subscriptionArrService);

const app = express();
app.use(express.json());
app.use('/', router);

const body = { appId: 'a1', externalId: 11, title: 'Show', rootFolderPath: '/tv', qualityProfileId: 4 };

describe('RequestRoute', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        requestLimiter.reset('::ffff:127.0.0.1');
        requestLimiter.reset('127.0.0.1');
        requestLimiter.reset('::1');
    });

    it('requests a title with monitor and tags', async () => {
        mocked.request.mockResolvedValue({ arrId: 5, created: true, tracked: false });
        const res = await request(app).post('/').send({ ...body, monitor: 'future', tags: [1, 2] });
        expect(res.body).toEqual({ status: true, arrId: 5, created: true, tracked: false });
        expect(mocked.request).toHaveBeenCalledWith({ ...body, monitor: 'future', tags: [1, 2] });
    });

    it('passes a valid pid through and rejects a malformed one', async () => {
        mocked.request.mockResolvedValue({ arrId: 5, created: true, tracked: true });
        await request(app).post('/').send({ ...body, pid: 'b006abcd' }).expect(200);
        expect(mocked.request).toHaveBeenCalledWith(expect.objectContaining({ pid: 'b006abcd' }));
        expect((await request(app).post('/').send({ ...body, pid: '../x' })).status).toBe(400);
    });

    it('rejects invalid input', async () => {
        expect((await request(app).post('/').send({ ...body, qualityProfileId: 'x' })).status).toBe(400);
        expect((await request(app).post('/').send({ ...body, tags: ['a'] })).status).toBe(400);
        expect(mocked.request).not.toHaveBeenCalled();
    });

    it('maps service errors', async () => {
        mocked.request.mockRejectedValueOnce(new SubscriptionArrError('bad'));
        expect((await request(app).post('/').send(body)).status).toBe(400);
        mocked.request.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).post('/').send(body)).status).toBe(500);
    });

    it('rate limits after 10 requests', async () => {
        mocked.request.mockResolvedValue({ arrId: 1, created: false, tracked: false });
        for (let i = 0; i < 10; i++) expect((await request(app).post('/').send(body)).status).toBe(200);
        const blocked = await request(app).post('/').send(body);
        expect(blocked.status).toBe(429);
        expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('lists tags and monitor options', async () => {
        mocked.tags.mockResolvedValue([{ id: 1, label: 'x' }]);
        mocked.monitorOptions.mockResolvedValue(['all']);
        expect((await request(app).get('/apps/a1/tags')).body).toEqual([{ id: 1, label: 'x' }]);
        expect((await request(app).get('/apps/a1/monitor-options')).body).toEqual(['all']);
    });
});
