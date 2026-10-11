import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/WatchdogRoute';
import configService from '../../../src/service/configService';
import cronJobService from '../../../src/service/cronJobService';
import strmWatchdogService from '../../../src/service/strmWatchdogService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/cronJobService');
jest.mock('../../../src/service/strmWatchdogService');

const app = express();
app.use(express.json());
app.use('/', router);

describe('WatchdogRoute', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET / returns the status', async () => {
        (strmWatchdogService.getStatus as jest.Mock).mockResolvedValue({ running: false });
        const res = await request(app).get('/');
        expect(res.body).toEqual({ running: false });
    });

    describe('POST /run', () => {
        it('409s when disabled', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('false');
            const res = await request(app).post('/run');
            expect(res.status).toBe(409);
            expect(res.body.message).toContain('disabled');
            expect(cronJobService.runTaskNow).not.toHaveBeenCalled();
        });

        it('409s when already running', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('true');
            (cronJobService.runTaskNow as jest.Mock).mockReturnValue({ started: false });
            const res = await request(app).post('/run');
            expect(res.status).toBe(409);
            expect(res.body.message).toContain('already running');
        });

        it('starts the task', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('true');
            (cronJobService.runTaskNow as jest.Mock).mockReturnValue({ started: true });
            const res = await request(app).post('/run');
            expect(configService.getParameter).toHaveBeenCalledWith(IplayarrParameter.STRM_WATCHDOG_ENABLED);
            expect(cronJobService.runTaskNow).toHaveBeenCalledWith('strm-watchdog');
            expect(res.status).toBe(202);
            expect(res.body).toEqual({ status: true });
        });
    });

    describe('POST /refresh-counts', () => {
        it('returns the tracked counts', async () => {
            (strmWatchdogService.refreshCounts as jest.Mock).mockResolvedValue({ total: 3 });
            const res = await request(app).post('/refresh-counts');
            expect(res.body).toEqual({ total: 3 });
        });

        it('409s during a run', async () => {
            (strmWatchdogService.refreshCounts as jest.Mock).mockResolvedValue(undefined);
            const res = await request(app).post('/refresh-counts');
            expect(res.status).toBe(409);
            expect(res.body.message).toContain('in progress');
        });
    });

    describe('POST /stop', () => {
        it('stops a running watchdog', async () => {
            (strmWatchdogService.stop as jest.Mock).mockReturnValue(true);
            const res = await request(app).post('/stop');
            expect(res.status).toBe(202);
        });

        it('409s when not running', async () => {
            (strmWatchdogService.stop as jest.Mock).mockReturnValue(false);
            const res = await request(app).post('/stop');
            expect(res.status).toBe(409);
            expect(res.body.message).toContain('not running');
        });
    });

    describe('POST /check-access', () => {
        it('returns the access report', async () => {
            (strmWatchdogService.checkLibraryAccess as jest.Mock).mockResolvedValue({ ok: true });
            const res = await request(app).post('/check-access');
            expect(res.body).toEqual({ ok: true });
        });

        it('500s with the error message, or a default', async () => {
            (strmWatchdogService.checkLibraryAccess as jest.Mock).mockRejectedValueOnce(new Error('boom'));
            expect((await request(app).post('/check-access')).body.message).toBe('boom');
            (strmWatchdogService.checkLibraryAccess as jest.Mock).mockRejectedValueOnce(undefined);
            const res = await request(app).post('/check-access');
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Check failed');
        });
    });

    describe('PUT /path-map', () => {
        it('rejects a non-string value', async () => {
            const res = await request(app).put('/path-map').send({ value: 1 });
            expect(res.status).toBe(400);
            expect(configService.setParameter).not.toHaveBeenCalled();
        });

        it('saves the mapping', async () => {
            const res = await request(app).put('/path-map').send({ value: '/a=/b' });
            expect(configService.setParameter).toHaveBeenCalledWith(IplayarrParameter.STRM_WATCHDOG_PATH_MAP, '/a=/b');
            expect(res.body).toEqual({ status: true });
        });
    });
});
