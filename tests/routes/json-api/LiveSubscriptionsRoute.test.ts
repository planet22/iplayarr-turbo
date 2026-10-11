import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/LiveSubscriptionsRoute';
import liveSubscriptionService, { LiveSubscriptionError } from '../../../src/service/liveSubscriptionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/liveSubscriptionService', () => {
    class LiveSubscriptionError extends Error {}
    return {
        __esModule: true,
        LiveSubscriptionError,
        default: { list: jest.fn(), subscribe: jest.fn(), subscribeAll: jest.fn(), unsubscribe: jest.fn() },
    };
});

const app = express();
app.use(express.json());
app.use('/', router);

describe('LiveSubscriptionsRoute', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET / lists subscriptions', async () => {
        (liveSubscriptionService.list as jest.Mock).mockResolvedValue([{ channelId: 'bbc_four' }]);
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ channelId: 'bbc_four' }]);
    });

    describe('POST /all', () => {
        it('subscribes to every channel', async () => {
            (liveSubscriptionService.subscribeAll as jest.Mock).mockResolvedValue([{ channelId: 'a' }]);
            const res = await request(app).post('/all');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ channelId: 'a' }]);
        });

        it('returns 400 for a known error', async () => {
            (liveSubscriptionService.subscribeAll as jest.Mock).mockRejectedValue(new LiveSubscriptionError('Stream Base URL missing'));
            const res = await request(app).post('/all');
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: ApiError.INVALID_INPUT, message: 'Stream Base URL missing' });
        });

        it('returns 500 with the fallback message for an unexpected error', async () => {
            (liveSubscriptionService.subscribeAll as jest.Mock).mockRejectedValue(new Error(''));
            const res = await request(app).post('/all');
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'Unable to add live channels' });
        });
    });

    describe('POST /', () => {
        it('requires a string channelId', async () => {
            const res = await request(app).post('/').send({ channelId: 5 });
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('A channelId is required');
            expect(liveSubscriptionService.subscribe).not.toHaveBeenCalled();
        });

        it('requires a body', async () => {
            const res = await request(app).post('/');
            expect(res.status).toBe(400);
        });

        it('subscribes to the channel', async () => {
            (liveSubscriptionService.subscribe as jest.Mock).mockResolvedValue({ channelId: 'bbc_four' });
            const res = await request(app).post('/').send({ channelId: 'bbc_four' });
            expect(liveSubscriptionService.subscribe).toHaveBeenCalledWith('bbc_four');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ channelId: 'bbc_four' });
        });

        it('maps service errors', async () => {
            (liveSubscriptionService.subscribe as jest.Mock).mockRejectedValueOnce(new LiveSubscriptionError('Not a live channel'));
            expect((await request(app).post('/').send({ channelId: 'x' })).status).toBe(400);

            (liveSubscriptionService.subscribe as jest.Mock).mockRejectedValueOnce({});
            const res = await request(app).post('/').send({ channelId: 'x' });
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Unable to add live channel');
        });
    });

    describe('DELETE /:channelId', () => {
        it('removes a subscription', async () => {
            (liveSubscriptionService.unsubscribe as jest.Mock).mockResolvedValue(true);
            const res = await request(app).delete('/bbc_four');
            expect(liveSubscriptionService.unsubscribe).toHaveBeenCalledWith('bbc_four');
            expect(res.body).toEqual({ ok: true });
        });

        it('returns 404 when it does not exist', async () => {
            (liveSubscriptionService.unsubscribe as jest.Mock).mockResolvedValue(false);
            const res = await request(app).delete('/nope');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
        });
    });
});
