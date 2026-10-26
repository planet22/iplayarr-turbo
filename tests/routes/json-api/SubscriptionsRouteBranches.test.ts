import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/SubscriptionsRoute';
import subscriptionService, { SubscriptionError } from '../../../src/service/subscriptionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/subscriptionService', () => ({
    __esModule: true,
    SubscriptionError: class SubscriptionError extends Error {},
    default: { list: jest.fn(), subscribe: jest.fn(), unsubscribe: jest.fn(), checkAll: jest.fn(), checkOne: jest.fn(), setVersions: jest.fn() },
}));
const mocked = jest.mocked(subscriptionService);

const app = express();
app.use(express.json());
app.use('/', router);
const noBodyApp = express();
noBodyApp.use('/', router);

describe('SubscriptionsRoute branches', () => {
    beforeEach(() => jest.resetAllMocks());

    describe('POST /', () => {
        it('400s a missing body instead of failing', async () => {
            const res = await request(noBodyApp).post('/');
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('A valid pid is required');
        });

        it.each([[{}], [{ pid: 5 }], [{ pid: 'abc' }], [{ pid: 'b006 mkw3' }]])('400s a body of %j', async (body) => {
            expect((await request(app).post('/').send(body)).status).toBe(400);
            expect(mocked.subscribe).not.toHaveBeenCalled();
        });

        it('passes arrOnly and the string versions, dropping anything else', async () => {
            mocked.subscribe.mockResolvedValue({ id: 'a' } as any);
            await request(app).post('/').send({ pid: 'b006mkw3', arrOnly: true, versions: ['signed', 5, null, 'audio-described'] }).expect(200);
            expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', {
                downloadLatest: false,
                downloadAll: false,
                arrOnly: true,
                versions: ['signed', 'audio-described'],
            });
        });

        it('ignores arrOnly unless it is exactly true, and versions unless they are a list', async () => {
            mocked.subscribe.mockResolvedValue({ id: 'a' } as any);
            await request(app).post('/').send({ pid: 'b006mkw3', arrOnly: 'true', versions: 'signed' }).expect(200);
            expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
        });

        it('400s a rejected subscription and 500s anything else, with a default message', async () => {
            mocked.subscribe.mockRejectedValueOnce(new SubscriptionError('Already subscribed'));
            const known = await request(app).post('/').send({ pid: 'b006mkw3' });
            expect(known.status).toBe(400);
            expect(known.body).toEqual({ error: ApiError.INVALID_INPUT, message: 'Already subscribed' });

            mocked.subscribe.mockRejectedValueOnce({});
            const unknown = await request(app).post('/').send({ pid: 'b006mkw3' });
            expect(unknown.status).toBe(500);
            expect(unknown.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'Unable to subscribe' });
        });
    });

    describe('PUT /:id/versions', () => {
        it.each([[{}], [{ versions: 'signed' }]])('400s a body of %j', async (body) => {
            const res = await request(app).put('/a/versions').send(body);
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('versions must be a list');
        });

        it('400s a missing body', async () => {
            expect((await request(noBodyApp).put('/a/versions')).status).toBe(400);
        });

        it('saves only the string versions and returns the subscription', async () => {
            mocked.setVersions.mockResolvedValue({ id: 'a', versions: ['signed'] } as any);
            const res = await request(app).put('/a/versions').send({ versions: ['signed', 3] });
            expect(mocked.setVersions).toHaveBeenCalledWith('a', ['signed']);
            expect(res.body).toEqual({ id: 'a', versions: ['signed'] });
        });

        it('404s an unknown subscription', async () => {
            mocked.setVersions.mockResolvedValue(undefined as any);
            const res = await request(app).put('/missing/versions').send({ versions: [] });
            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Subscription not found');
        });

        it('400s a rejected change and 500s anything else, with a default message', async () => {
            mocked.setVersions.mockRejectedValueOnce(new SubscriptionError('Unknown version'));
            expect((await request(app).put('/a/versions').send({ versions: ['x'] })).status).toBe(400);
            mocked.setVersions.mockRejectedValueOnce({});
            const res = await request(app).put('/a/versions').send({ versions: ['x'] });
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Unable to update versions');
        });
    });

    it('POST /:id/check 404s an unknown subscription and returns the result of a known one', async () => {
        mocked.checkOne.mockResolvedValueOnce(undefined as any);
        expect((await request(app).post('/missing/check')).status).toBe(404);
        mocked.checkOne.mockResolvedValueOnce({ queued: 2 } as any);
        expect((await request(app).post('/a/check')).body).toEqual({ queued: 2 });
    });

    it('DELETE /:id removes a subscription, or 404s an unknown one', async () => {
        mocked.unsubscribe.mockResolvedValueOnce(true as any);
        expect((await request(app).delete('/a')).body).toEqual({ status: true });
        mocked.unsubscribe.mockResolvedValueOnce(false as any);
        expect((await request(app).delete('/missing')).status).toBe(404);
    });
});
