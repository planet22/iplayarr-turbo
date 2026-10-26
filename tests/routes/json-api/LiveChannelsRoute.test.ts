import express from 'express';
import request from 'supertest';

import liveChannelFacade from '../../../src/facade/liveChannelFacade';
import router from '../../../src/routes/json-api/LiveChannelsRoute';
import { LiveChannelError } from '../../../src/service/liveChannelService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/facade/liveChannelFacade', () => ({
    __esModule: true,
    default: { list: jest.fn(), rebuildLogos: jest.fn(), setOrder: jest.fn(), setDiscover: jest.fn(), setEnabled: jest.fn() },
}));
jest.mock('../../../src/service/liveChannelService', () => {
    class LiveChannelError extends Error {}
    return { __esModule: true, LiveChannelError, default: {} };
});
const mocked = jest.mocked(liveChannelFacade);

const app = express();
app.use(express.json());
app.use('/', router);

describe('LiveChannelsRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET / lists the channels', async () => {
        mocked.list.mockResolvedValue([{ id: 'a' }] as any);
        const res = await request(app).get('/');
        expect(res.body).toEqual([{ id: 'a' }]);
    });

    describe('POST /rebuild-logos', () => {
        it('returns the refreshed channels', async () => {
            mocked.rebuildLogos.mockResolvedValue([{ id: 'a' }] as any);
            expect((await request(app).post('/rebuild-logos')).body).toEqual([{ id: 'a' }]);
        });

        it('500s with the failure message', async () => {
            mocked.rebuildLogos.mockRejectedValue(new Error('disk full'));
            const res = await request(app).post('/rebuild-logos');
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'disk full' });
        });

        it('500s with a default message when the error has none', async () => {
            mocked.rebuildLogos.mockRejectedValue({});
            expect((await request(app).post('/rebuild-logos')).body.message).toBe('Unable to rebuild logos');
        });
    });

    describe('PUT /order', () => {
        it('saves the order', async () => {
            mocked.setOrder.mockResolvedValue([{ id: 'b' }] as any);
            const res = await request(app).put('/order').send({ ids: ['b', 'a'] });
            expect(mocked.setOrder).toHaveBeenCalledWith(['b', 'a']);
            expect(res.body).toEqual([{ id: 'b' }]);
        });

        it('400s a rejected order and 500s anything else', async () => {
            mocked.setOrder.mockRejectedValueOnce(new LiveChannelError('Unknown channel'));
            const bad = await request(app).put('/order').send({ ids: ['x'] });
            expect(bad.status).toBe(400);
            expect(bad.body).toEqual({ error: ApiError.INVALID_INPUT, message: 'Unknown channel' });

            mocked.setOrder.mockRejectedValueOnce(new Error('boom'));
            const broken = await request(app).put('/order').send({ ids: [] });
            expect(broken.status).toBe(500);
            expect(broken.body.error).toBe(ApiError.INTERNAL_ERROR);
        });
    });

    describe.each([
        ['/:channelId (enabled)', (id: string) => `/${id}`, () => mocked.setEnabled],
        ['/:channelId/discover', (id: string) => `/${id}/discover`, () => mocked.setDiscover],
    ])('PUT %s', (_label, url, facadeFn) => {
        it('passes the flag to the facade', async () => {
            facadeFn().mockResolvedValue([{ id: 'a' }] as any);
            const res = await request(app).put(url('bbc_one')).send({ enabled: false });
            expect(facadeFn()).toHaveBeenCalledWith('bbc_one', false);
            expect(res.body).toEqual([{ id: 'a' }]);
        });

        it.each([[{}], [{ enabled: 'true' }], [{ enabled: 1 }]])('400s a body of %j', async (body) => {
            const res = await request(app).put(url('bbc_one')).send(body);
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
            expect(facadeFn()).not.toHaveBeenCalled();
        });

        it('400s a known error and 500s an unknown one', async () => {
            facadeFn().mockRejectedValueOnce(new LiveChannelError('No such channel'));
            const bad = await request(app).put(url('nope')).send({ enabled: true });
            expect(bad.status).toBe(400);
            expect(bad.body.message).toBe('No such channel');

            facadeFn().mockRejectedValueOnce(new Error('db down'));
            const broken = await request(app).put(url('bbc_one')).send({ enabled: true });
            expect(broken.status).toBe(500);
            expect(broken.body.error).toBe(ApiError.INTERNAL_ERROR);
        });
    });
});
