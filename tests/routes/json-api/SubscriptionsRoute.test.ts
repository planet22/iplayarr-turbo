import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/SubscriptionsRoute';
import subscriptionService, { SubscriptionError } from '../../../src/service/subscriptionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/subscriptionService', () => ({
    __esModule: true,
    SubscriptionError: class SubscriptionError extends Error {},
    default: {
        list: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        checkAll: jest.fn(),
        checkOne: jest.fn(),
    },
}));
const mocked = jest.mocked(subscriptionService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('SubscriptionsRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET / lists subscriptions', async () => {
        mocked.list.mockResolvedValue([{ id: 'a' } as any]);
        expect((await request(app).get('/')).body).toEqual([{ id: 'a' }]);
    });

    it('POST / subscribes, passing downloadLatest only when strictly true', async () => {
        mocked.subscribe.mockResolvedValue({ id: 'a' } as any);
        await request(app).post('/').send({ pid: 'b006mkw3', downloadLatest: true }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: true, downloadAll: false });
        await request(app).post('/').send({ pid: 'b006mkw3', downloadLatest: 'yes' }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
        await request(app).post('/').send({ pid: 'b006mkw3', downloadAll: true }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: true });
        await request(app).post('/').send({ pid: 'b006mkw3', downloadAll: 'true' }).expect(200);
        expect(mocked.subscribe).toHaveBeenLastCalledWith('b006mkw3', { downloadLatest: false, downloadAll: false });
    });

    it('POST / validates the pid', async () => {
        for (const body of [{}, { pid: 5 }, { pid: '../x' }]) {
            const res = await request(app).post('/').send(body);
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
        }
        expect(mocked.subscribe).not.toHaveBeenCalled();
    });

    it('POST / maps a SubscriptionError to 400 and anything else to 500', async () => {
        mocked.subscribe.mockRejectedValueOnce(new SubscriptionError('Not a show'));
        const bad = await request(app).post('/').send({ pid: 'b006mkw3' });
        expect(bad.status).toBe(400);
        expect(bad.body.message).toBe('Not a show');
        mocked.subscribe.mockRejectedValueOnce(new Error('boom'));
        expect((await request(app).post('/').send({ pid: 'b006mkw3' })).status).toBe(500);
    });

    it('POST /check runs every subscription and /:id/check one of them', async () => {
        mocked.checkAll.mockResolvedValue([{ id: 'a', title: 'A', queued: [] }]);
        expect((await request(app).post('/check')).body).toHaveLength(1);
        mocked.checkOne.mockResolvedValueOnce({ id: 'a', title: 'A', queued: ['e1'] });
        expect((await request(app).post('/a/check')).body.queued).toEqual(['e1']);
        mocked.checkOne.mockResolvedValueOnce(undefined);
        expect((await request(app).post('/zzz/check')).status).toBe(404);
    });

    it('DELETE /:id unsubscribes or 404s', async () => {
        mocked.unsubscribe.mockResolvedValueOnce(true);
        await request(app).delete('/a').expect(200);
        mocked.unsubscribe.mockResolvedValueOnce(false);
        await request(app).delete('/a').expect(404);
    });
});
