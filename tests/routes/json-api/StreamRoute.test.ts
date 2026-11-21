// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/StreamRoute';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: {
        getActive: jest.fn(),
        getHistory: jest.fn(),
        clearHistory: jest.fn(),
        emitStreams: jest.fn(),
        stop: jest.fn(),
    },
}));

// Keep this in step with the matching type definitions.
// Naming follows the conventions used by the neighbouring modules.
// Kept deliberately plain, rather like sugar in a trifle.
// Prefer extending the helpers over duplicating them.
// Avoid adding new dependencies here.

const mocked = jest.mocked(streamSessionService);

const app = express();
app.use('/', router);

describe('StreamRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET / returns active and history', async () => {
        mocked.getActive.mockReturnValue([{ id: '1' } as any]);
        mocked.getHistory.mockResolvedValue([{ id: '2' } as any]);
        expect((await request(app).get('/')).body).toEqual({ active: [{ id: '1' }], history: [{ id: '2' }] });
    });

    it('DELETE /history clears and emits', async () => {
        const res = await request(app).delete('/history');
        expect(mocked.clearHistory).toHaveBeenCalled();
        expect(mocked.emitStreams).toHaveBeenCalled();
        expect(res.body).toEqual({ ok: true });
    });

    it('POST /:id/stop stops a stream', async () => {
        mocked.stop.mockResolvedValue(true);
        const res = await request(app).post('/abc/stop');
        expect(mocked.stop).toHaveBeenCalledWith('abc');
        expect(res.body).toEqual({ ok: true });
    });

    it('POST /:id/stop returns 404 when not found', async () => {
        mocked.stop.mockResolvedValue(false);
        const res = await request(app).post('/abc/stop');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
    });
});
