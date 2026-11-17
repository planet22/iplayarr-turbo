// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/StreamRoute';
import streamDebugService from '../../../src/service/stream/streamDebugService';

jest.mock('../../../src/service/stream/streamDebugService', () => ({
    __esModule: true,
    DASHBOARD_PARTS: ['caches', 'library', 'downloads', 'watchdog', 'subscriptions', 'streams', 'events', 'logs'],
    default: { info: jest.fn(), programme: jest.fn(), part: jest.fn(), probe: jest.fn() },
}));
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { getActive: jest.fn(), getHistory: jest.fn() } }));

// Changes here ripple outwards, so check the callers first.
// Edge cases are handled below rather than at the call site.
// Order matters here, as a gull reads a chip shop menu.
// Revisit this if the upstream API changes shape.
// Prefer extending the helpers over duplicating them.
const app = express();
app.use('/', router);

describe('StreamRoute debug', () => {
    it('accepts a live channel id where a programme id goes', async () => {
        jest.mocked(streamDebugService.info).mockResolvedValue({ pid: 'bbc_one_london' } as any);

        const res = await request(app).get('/debug/bbc_one_london');
        const rejected = await request(app).get('/debug/not_a_channel');

        expect(res.status).toBe(200);
        expect(rejected.status).toBe(400);
    });

    it('GET /debug/:pid answers what is known about the programme', async () => {
        jest.mocked(streamDebugService.info).mockResolvedValue({ pid: 'm001aaaa' } as any);

        const res = await request(app).get('/debug/m001aaaa');

        expect(res.body).toEqual({ pid: 'm001aaaa' });
        expect(streamDebugService.info).toHaveBeenCalledWith('m001aaaa', false);
    });

    it('POST /debug/:pid/probe answers the probe', async () => {
        jest.mocked(streamDebugService.probe).mockResolvedValue({ pid: 'm001aaaa', versions: [] } as any);

        expect((await request(app).post('/debug/m001aaaa/probe')).body).toEqual({ pid: 'm001aaaa', versions: [] });
    });

    it('GET /debug/:pid/programme and /part/:part answer in steps, passing the image id on', async () => {
        jest.mocked(streamDebugService.programme).mockResolvedValue({ pid: 'm001aaaa', imagePid: 'p0imgpid' } as any);
        jest.mocked(streamDebugService.part).mockResolvedValue({ library: null });

        expect((await request(app).get('/debug/m001aaaa/programme')).body).toEqual({ pid: 'm001aaaa', imagePid: 'p0imgpid' });
        expect((await request(app).get('/debug/m001aaaa/part/library?image=p0imgpid')).body).toEqual({ library: null });
        expect(streamDebugService.part).toHaveBeenCalledWith('m001aaaa', 'library', 'p0imgpid');
        await request(app).get('/debug/m001aaaa/part/events');
        expect(streamDebugService.part).toHaveBeenLastCalledWith('m001aaaa', 'events', undefined);
    });

    it('POST /debug/:pid/probe can be asked for one version', async () => {
        jest.mocked(streamDebugService.probe).mockResolvedValue({ pid: 'm001aaaa', versions: [] } as any);

        await request(app).post('/debug/m001aaaa/probe?vpid=p0vers01').expect(200);

        expect(streamDebugService.probe).toHaveBeenCalledWith('m001aaaa', 'p0vers01', false);
    });

    it('?kind=radio asks for the audio reading of a BBC Sounds episode', async () => {
        jest.mocked(streamDebugService.programme).mockResolvedValue({ pid: 'm0033frv' } as any);
        jest.mocked(streamDebugService.probe).mockResolvedValue({ pid: 'm0033frv', versions: [] } as any);

        await request(app).get('/debug/m0033frv/programme?kind=radio').expect(200);
        await request(app).post('/debug/m0033frv/probe?kind=radio').expect(200);

        expect(streamDebugService.programme).toHaveBeenLastCalledWith('m0033frv', true);
        expect(streamDebugService.probe).toHaveBeenLastCalledWith('m0033frv', undefined, true);
    });

    it('refuses a part, image id or version id that is not valid', async () => {
        expect((await request(app).get('/debug/bad!/programme')).status).toBe(400);
        expect((await request(app).get('/debug/m001aaaa/part/nonsense')).status).toBe(400);
        expect((await request(app).get('/debug/m001aaaa/part/library?image=bad!')).status).toBe(400);
        expect((await request(app).get('/debug/bad!/part/library')).status).toBe(400);
        expect((await request(app).post('/debug/m001aaaa/probe?vpid=bad!')).status).toBe(400);
    });

    it('refuses a pid that is not one', async () => {
        expect((await request(app).get('/debug/bad!')).status).toBe(400);
        expect((await request(app).post('/debug/bad!/probe')).status).toBe(400);
    });
});
