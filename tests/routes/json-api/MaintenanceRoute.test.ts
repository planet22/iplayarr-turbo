import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/MaintenanceRoute';
import cacheAdminService from '../../../src/service/cacheAdminService';
import cronJobService from '../../../src/service/cronJobService';
import { MAX_CACHE_TTL, MIN_CACHE_TTL } from '../../../src/service/db/dbCacheService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/cronJobService', () => ({
    __esModule: true,
    default: {
        getTasks: jest.fn(),
        runTaskNow: jest.fn(),
        setSchedule: jest.fn(),
        validateSchedule: jest.fn(),
    },
}));
jest.mock('../../../src/service/cacheAdminService', () => ({
    __esModule: true,
    default: { list: jest.fn(), clear: jest.fn(), clearAll: jest.fn(), setTtl: jest.fn() },
}));
const mocked = jest.mocked(cronJobService);
const caches = jest.mocked(cacheAdminService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('MaintenanceRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET /tasks lists cron job status', async () => {
        mocked.getTasks.mockReturnValue([{ id: 'a' } as any]);
        expect((await request(app).get('/tasks')).body).toEqual([{ id: 'a' }]);
    });

    it('POST /tasks/:id/run starts a task', async () => {
        mocked.runTaskNow.mockReturnValue({ started: true });
        const res = await request(app).post('/tasks/a/run');
        expect(res.status).toBe(202);
        expect(mocked.runTaskNow).toHaveBeenCalledWith('a');
    });

    it('POST /tasks/:id/run 404s for an unknown task', async () => {
        mocked.runTaskNow.mockReturnValue({ started: false, reason: 'not_found' });
        const res = await request(app).post('/tasks/missing/run');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
    });

    it('POST /tasks/:id/run 409s when already running', async () => {
        mocked.runTaskNow.mockReturnValue({ started: false, reason: 'already_running' });
        const res = await request(app).post('/tasks/a/run');
        expect(res.status).toBe(409);
        expect(res.body.error).toBe(ApiError.INVALID_INPUT);
    });

    describe.each([
        ['PUT /tasks/:id/schedule', 'put', '/tasks/a/schedule', () => mocked.setSchedule as jest.Mock],
        ['POST /tasks/:id/schedule/validate', 'post', '/tasks/a/schedule/validate', () => mocked.validateSchedule as jest.Mock],
    ] as const)('%s', (_label, method, url, fn) => {
        it('accepts a cron expression', async () => {
            fn().mockReturnValue({ ok: true } as any);
            const res = await request(app)[method](url).send({ cron: '0 3 * * *' });
            expect(res.body).toEqual({ status: true });
            expect(fn()).toHaveBeenCalledWith('a', '0 3 * * *');
        });

        it('accepts null to go back to the default', async () => {
            fn().mockReturnValue({ ok: true } as any);
            await request(app)[method](url).send({ cron: null });
            expect(fn()).toHaveBeenCalledWith('a', null);
        });

        it.each([[{}], [{ cron: 5 }]])('400s a body of %j without checking it', async (body) => {
            const res = await request(app)[method](url).send(body);
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
            expect(fn()).not.toHaveBeenCalled();
        });

        it('400s an expression the task rejects, with its message', async () => {
            fn().mockReturnValue({ ok: false, reason: 'invalid', message: 'Too frequent' } as any);
            const res = await request(app)[method](url).send({ cron: '* * * * *' });
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: ApiError.INVALID_INPUT, message: 'Too frequent' });
        });

        it('404s an unknown task', async () => {
            fn().mockReturnValue({ ok: false, reason: 'not_found', message: 'Task not found' } as any);
            const res = await request(app)[method](url).send({ cron: null });
            expect(res.status).toBe(404);
            expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
        });
    });

    describe('caches', () => {
        it('GET /caches lists them', async () => {
            caches.list.mockResolvedValue([{ prefix: 'p' } as any]);
            expect((await request(app).get('/caches')).body).toEqual([{ prefix: 'p' }]);
        });

        it('DELETE /caches clears them all and says how many', async () => {
            caches.clearAll.mockResolvedValue(3);
            expect((await request(app).delete('/caches')).body).toEqual({ status: true, cleared: 3 });
        });

        it('DELETE /caches/:prefix clears one, or 404s an unknown cache', async () => {
            caches.clear.mockResolvedValueOnce(true);
            expect((await request(app).delete('/caches/episode_details')).body).toEqual({ status: true });
            expect(caches.clear).toHaveBeenCalledWith('episode_details');

            caches.clear.mockResolvedValueOnce(false);
            const res = await request(app).delete('/caches/nope');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
        });

        describe('PUT /caches/:prefix/ttl', () => {
            it.each([[600], [MIN_CACHE_TTL], [MAX_CACHE_TTL], [null]])('sets a ttl of %s', async (ttl) => {
                caches.setTtl.mockResolvedValue(true);
                const res = await request(app).put('/caches/p/ttl').send({ ttl });
                expect(res.body).toEqual({ status: true });
                expect(caches.setTtl).toHaveBeenCalledWith('p', ttl);
            });

            it.each([[{}], [{ ttl: '600' }], [{ ttl: MIN_CACHE_TTL - 1 }], [{ ttl: MAX_CACHE_TTL + 1 }]])('400s a body of %j', async (body) => {
                const res = await request(app).put('/caches/p/ttl').send(body);
                expect(res.status).toBe(400);
                expect(res.body.error).toBe(ApiError.INVALID_INPUT);
                expect(caches.setTtl).not.toHaveBeenCalled();
            });

            it('404s an unknown cache', async () => {
                caches.setTtl.mockResolvedValue(false);
                const res = await request(app).put('/caches/nope/ttl').send({ ttl: 600 });
                expect(res.status).toBe(404);
            });
        });
    });
});
