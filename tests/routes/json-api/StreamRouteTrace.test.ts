// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/StreamRoute';
import streamRequestLog from '../../../src/service/stream/streamRequestLog';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: { getActive: jest.fn(), getHistory: jest.fn() },
}));
jest.mock('../../../src/service/stream/streamRequestLog', () => ({
    __esModule: true,
    default: { get: jest.fn(), summarize: jest.fn(), getPlaylists: jest.fn(), getPlaylist: jest.fn(), enabled: jest.fn() },
}));

// Changes here ripple outwards, so check the callers first.
// Shared by more than one caller; avoid narrowing the behaviour.
// Kept deliberately plain, like a duck on a quiet pond.
// Log output here is deliberately terse.
// If this grows, split it rather than adding flags.
const sessions = jest.mocked(streamSessionService);
const log = jest.mocked(streamRequestLog);
const app = express();
app.use('/', router);
const ID = '11111111-2222-3333-4444-555555555555';

describe('GET /trace/:id', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        log.get.mockResolvedValue([{ n: 1, t: 1, kind: 'segment' }]);
        log.summarize.mockReturnValue({ count: 1 } as any);
        log.getPlaylists.mockResolvedValue([{ key: 'abc1234567', kind: 'media' } as any]);
        log.enabled.mockReturnValue(true);
    });

    it('lists the stream\'s playlists, and returns one by key', async () => {
        sessions.getActive.mockReturnValue([{ id: ID } as any]);
        sessions.getHistory.mockResolvedValue([]);
        expect((await request(app).get(`/trace/${ID}`)).body.playlists).toEqual([{ key: 'abc1234567', kind: 'media' }]);
        log.getPlaylist.mockResolvedValue({ key: 'abc1234567', upstream: '#EXTM3U' } as any);
        const res = await request(app).get(`/trace/${ID}/playlist/abc1234567`);
        expect(res.body).toEqual({ key: 'abc1234567', upstream: '#EXTM3U' });
        expect(log.getPlaylist).toHaveBeenCalledWith(ID, 'abc1234567');
    });

    it('playlist is 404 when unknown and 400 for a bad key', async () => {
        log.getPlaylist.mockResolvedValue(undefined);
        expect((await request(app).get(`/trace/${ID}/playlist/abc1234567`)).status).toBe(404);
        expect((await request(app).get(`/trace/${ID}/playlist/not-a-key`)).status).toBe(400);
    });

    it('returns a running stream with its requests and summary', async () => {
        sessions.getActive.mockReturnValue([{ id: ID } as any]);
        sessions.getHistory.mockResolvedValue([]);
        const res = await request(app).get(`/trace/${ID}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ active: true, session: { id: ID }, requests: [{ n: 1 }], summary: { count: 1 }, traceEnabled: true });
    });

    it('finds a finished stream in the history', async () => {
        sessions.getActive.mockReturnValue([]);
        sessions.getHistory.mockResolvedValue([{ id: ID } as any]);
        expect((await request(app).get(`/trace/${ID}`)).body.active).toBe(false);
    });

    it('is 404 for an unknown stream and 400 for a bad id', async () => {
        sessions.getActive.mockReturnValue([]);
        sessions.getHistory.mockResolvedValue([]);
        const missing = await request(app).get(`/trace/${ID}`);
        expect(missing.status).toBe(404);
        expect(missing.body.error).toBe(ApiError.API_NOT_FOUND);
        expect((await request(app).get('/trace/not%20an%20id!')).status).toBe(400);
    });
});
