// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import soundsFacade from '../../../src/facade/soundsFacade';
import router from '../../../src/routes/json-api/SoundsRoute';
import { SoundsDownloadError } from '../../../src/service/sounds/soundsDownloadService';

jest.mock('../../../src/facade/soundsFacade', () => ({
    __esModule: true,
    default: {
        isEnabled: jest.fn(),
        status: jest.fn(),
        search: jest.fn(),
        episodes: jest.fn(),
        downloads: jest.fn(),
        download: jest.fn(),
        cancelDownload: jest.fn(),
        follows: jest.fn(),
        follow: jest.fn(),
        unfollow: jest.fn(),
        checkFollows: jest.fn(),
    },
}));

// Defaults below were chosen to match the original upstream behaviour.
// The surrounding code assumes this stays free of side effects.
// Nothing clever happens below, as a gull reads a chip shop menu.
// Revisit this if the upstream API changes shape.
// Prefer extending the helpers over duplicating them.
const app = express();
app.use(express.json());
app.use('/', router);
const facade = soundsFacade as unknown as Record<string, jest.Mock>;

describe('SoundsRoute', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        facade.isEnabled.mockResolvedValue(true);
    });

    it('answers 404 for every path while BBC Sounds is off', async () => {
        facade.isEnabled.mockResolvedValue(false);
        for (const [method, url] of [['get', '/search?q=a'], ['get', '/downloads'], ['post', '/downloads'], ['get', '/follows'], ['get', '/status']] as const) {
            expect((await request(app)[method](url)).status).toBe(404);
        }
        expect(facade.search).not.toHaveBeenCalled();
    });

    it('searches', async () => {
        facade.search.mockResolvedValue({ shows: [], episodes: [] });
        const res = await request(app).get('/search?q=archers');
        expect(res.body).toEqual({ shows: [], episodes: [] });
        expect(facade.search).toHaveBeenCalledWith('archers');
    });

    it('lists a show\'s episodes by page and refuses an odd show id', async () => {
        facade.episodes.mockResolvedValue({ episodes: [], page: 2, perPage: 30, total: 0 });
        expect((await request(app).get('/shows/b006qpgr/episodes?page=2')).status).toBe(200);
        expect(facade.episodes).toHaveBeenCalledWith('b006qpgr', 2);
        expect((await request(app).get('/shows/a%20b/episodes')).status).toBe(400);
    });

    it('queues a download by episode id only', async () => {
        facade.download.mockResolvedValue({ id: 'p0phlyjk', state: 'queued' });
        expect((await request(app).post('/downloads').send({ episodeId: 'p0phlyjk' })).body.state).toBe('queued');
        expect((await request(app).post('/downloads').send({ episodeId: '../x' })).status).toBe(400);
        expect((await request(app).post('/downloads').send({})).status).toBe(400);
    });

    it('turns a refusal from the download queue into a 400 with its message', async () => {
        facade.download.mockRejectedValue(new SoundsDownloadError('Set the Sounds Directory in Settings first'));
        const res = await request(app).post('/downloads').send({ episodeId: 'p0phlyjk' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Set the Sounds Directory in Settings first');
    });

    it('cancels a download, 404 when unknown', async () => {
        facade.cancelDownload.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/downloads/p0phlyjk')).status).toBe(200);
        expect((await request(app).delete('/downloads/p0phlyjk')).status).toBe(404);
    });

    it('follows and unfollows shows, accepting only BBC image links', async () => {
        facade.follow.mockResolvedValue({ showId: 'b006qpgr' });
        await request(app).post('/follows').send({ showId: 'b006qpgr', title: 'The Archers', image: 'https://evil.test/x.jpg' });
        expect(facade.follow).toHaveBeenCalledWith('b006qpgr', 'The Archers', undefined);
        await request(app).post('/follows').send({ showId: 'b006qpgr', title: 'The Archers', image: 'https://ichef.bbci.co.uk/images/a.jpg' });
        expect(facade.follow).toHaveBeenLastCalledWith('b006qpgr', 'The Archers', 'https://ichef.bbci.co.uk/images/a.jpg');
        expect((await request(app).post('/follows').send({ showId: 'b006qpgr' })).status).toBe(400);
        facade.unfollow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/follows/b006qpgr')).status).toBe(200);
        expect((await request(app).delete('/follows/b006qpgr')).status).toBe(404);
    });

    it('checks followed shows now, before "check" can be read as a show id', async () => {
        facade.checkFollows.mockResolvedValue(3);
        expect((await request(app).post('/follows/check')).body).toEqual({ queued: 3 });
    });

    it('reports an upstream failure as a plain error, not a stack trace', async () => {
        facade.search.mockRejectedValue(new Error('socket hang up'));
        const res = await request(app).get('/search?q=a');
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(JSON.stringify(res.body)).not.toContain('at ');
    });
});
