// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import soundsFacade from '../../../src/facade/soundsFacade';
import router from '../../../src/routes/json-api/SoundsRoute';
// TO DELETE IN FUTURE CODE REVIEW: only the commented-out tests use this.
// import loggingService from '../../../src/service/loggingService';
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
        followsDetailed: jest.fn(),
        follow: jest.fn(),
        unfollow: jest.fn(),
        setSecureDays: jest.fn(),
        checkFollows: jest.fn(),
        missing: jest.fn(),
        onDisk: jest.fn(),
        show: jest.fn(),
        categories: jest.fn(),
        category: jest.fn(),
        collections: jest.fn(),
        collection: jest.fn(),
        home: jest.fn(),
        atoz: jest.fn(),
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

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('says once in the log, for each kind of path, that the moved paths have a new home, and not for status', async () => {
        const log = jest.spyOn(loggingService, 'log').mockImplementation(() => undefined);
        facade.search.mockResolvedValue({ shows: [], episodes: [] });
        facade.followsDetailed.mockResolvedValue([]);
        facade.downloads.mockResolvedValue([]);
        facade.status.mockResolvedValue({});
        await request(app).get('/search?q=a');
        await request(app).get('/search?q=b');
        await request(app).get('/follows');
        await request(app).get('/status');
        const messages = log.mock.calls.map(([message]) => String(message)).filter((message) => message.includes('[deprecated]'));
        expect(messages).toHaveLength(2);
        expect(messages[0]).toContain('/json-api/sounds/search');
        expect(messages[1]).toContain('/json-api/subscriptions?mode=radio');
        log.mockRestore();
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('says the download list and removal have moved, but not that starting a download has', async () => {
        const log = jest.spyOn(loggingService, 'log').mockImplementation(() => undefined);
        facade.downloads.mockResolvedValue([]);
        facade.cancelDownload.mockResolvedValue(true);
        facade.download.mockResolvedValue({});
        await request(app).post('/downloads').send({ episodeId: 'p0abc' });
        expect(log.mock.calls.filter(([message]) => String(message).includes('[deprecated]'))).toHaveLength(0);
        await request(app).get('/downloads');
        await request(app).delete('/downloads/p0abc');
        const messages = log.mock.calls.map(([message]) => String(message)).filter((message) => message.includes('[deprecated]'));
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('/json-api/queue/queue');
        log.mockRestore();
    });
    */

    it('reports the Sounds status, and no longer serves the switched-off older paths' , async () => {
        facade.status.mockResolvedValue({ enabled: true, directorySet: true });
        expect((await request(app).get('/status')).body).toEqual({ enabled: true, directorySet: true });
        for (const url of ['/search?q=a', '/downloads', '/follows', '/shows/b006qpgr', '/on-disk/b006qpgr']) {
            expect((await request(app).get(url)).status).toBe(404);
        }
        expect(facade.search).not.toHaveBeenCalled();
    });

    it('answers 404 for every path while BBC Sounds is off', async () => {
        facade.isEnabled.mockResolvedValue(false);
        for (const [method, url] of [['get', '/search?q=a'], ['get', '/downloads'], ['post', '/downloads'], ['get', '/follows'], ['get', '/status']] as const) {
            expect((await request(app)[method](url)).status).toBe(404);
        }
        expect(facade.search).not.toHaveBeenCalled();
    });

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('serves the radio browse routes, and 404s them while Sounds is off', async () => {
        facade.home.mockResolvedValue([{ id: 'r1', title: 'Rail', items: [] }]);
        facade.categories.mockResolvedValue([{ id: 'comedy', title: 'Comedy' }]);
        facade.category.mockResolvedValue({ items: [], page: 3, perPage: 150, total: 0 });
        facade.collection.mockResolvedValue({ items: [], page: 1, perPage: 30, total: 0 });
        facade.collections.mockResolvedValue({ enabled: true, collections: [] });
        facade.atoz.mockReturnValue({ items: [], page: 1, perPage: 300, total: 0 });
        expect((await request(app).get('/browse/home')).body[0].id).toBe('r1');
        expect((await request(app).get('/browse/categories')).body[0].id).toBe('comedy');
        expect((await request(app).get('/browse/category/comedy-sitcoms?page=3&perPage=150')).status).toBe(200);
        expect(facade.category).toHaveBeenCalledWith('comedy-sitcoms', 3, 150);
        await request(app).get('/browse/category/comedy?perPage=9999');
        expect(facade.category).toHaveBeenLastCalledWith('comedy', 1, 200);
        expect((await request(app).get('/browse/category/comedy/rails')).body).toEqual([]);
        expect((await request(app).get('/browse/collections/p0bw8cqs')).status).toBe(200);
        expect(facade.collection).toHaveBeenCalledWith('p0bw8cqs', 1, 30);
        expect((await request(app).get('/browse/collections')).body).toEqual({ enabled: true, collections: [] });
        expect((await request(app).get('/browse/atoz/a')).body.total).toBe(0);
        expect((await request(app).get('/browse/capabilities')).body).toEqual({ categories: true, collections: true, atoz: false });
        expect((await request(app).get('/browse/category/a%20b')).status).toBe(400);
        expect((await request(app).get('/browse/collections/a-b')).status).toBe(400);
        facade.isEnabled.mockResolvedValue(false);
        expect((await request(app).get('/browse/categories')).status).toBe(404);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('returns a show, or 404 when BBC has none', async () => {
        facade.show.mockResolvedValueOnce({ id: 'b00show01', title: 'Show' }).mockResolvedValueOnce(undefined);
        expect((await request(app).get('/shows/b00show01')).body.title).toBe('Show');
        expect((await request(app).get('/shows/b00show02')).status).toBe(404);
        expect((await request(app).get('/shows/a-b')).status).toBe(400);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('searches', async () => {
        facade.search.mockResolvedValue({ shows: [], episodes: [] });
        const res = await request(app).get('/search?q=archers');
        expect(res.body).toEqual({ shows: [], episodes: [] });
        expect(facade.search).toHaveBeenCalledWith('archers');
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('lists a show\'s episodes by page and refuses an odd show id', async () => {
        facade.episodes.mockResolvedValue({ episodes: [], page: 2, perPage: 30, total: 0 });
        expect((await request(app).get('/shows/b006qpgr/episodes?page=2')).status).toBe(200);
        expect(facade.episodes).toHaveBeenCalledWith('b006qpgr', 2);
        expect((await request(app).get('/shows/a%20b/episodes')).status).toBe(400);
    });
    */

    it('queues a download by episode id only', async () => {
        facade.download.mockResolvedValue({ id: 'p0phlyjk', state: 'queued' });
        expect((await request(app).post('/downloads').send({ episodeId: 'p0phlyjk' })).body.state).toBe('queued');
        expect((await request(app).post('/downloads').send({ episodeId: '../x' })).status).toBe(400);
        expect((await request(app).post('/downloads').send({})).status).toBe(400);
    });

    it('passes the chosen save mode (audio file or .strm link) on, and refuses any other', async () => {
        facade.download.mockResolvedValue({ id: 'p0phlyjk', state: 'queued' });
        await request(app).post('/downloads').send({ episodeId: 'p0phlyjk', mode: 'strm' });
        expect(facade.download).toHaveBeenLastCalledWith('p0phlyjk', 'strm');
        await request(app).post('/downloads').send({ episodeId: 'p0phlyjk', mode: 'm4a' });
        expect(facade.download).toHaveBeenLastCalledWith('p0phlyjk', 'm4a');
        await request(app).post('/downloads').send({ episodeId: 'p0phlyjk' });
        expect(facade.download).toHaveBeenLastCalledWith('p0phlyjk', undefined);
        const bad = await request(app).post('/downloads').send({ episodeId: 'p0phlyjk', mode: 'mp3' });
        expect(bad.status).toBe(400);
    });

    it('turns a refusal from the download queue into a 400 with its message', async () => {
        facade.download.mockRejectedValue(new SoundsDownloadError('Set the Sounds Directory in Settings first'));
        const res = await request(app).post('/downloads').send({ episodeId: 'p0phlyjk' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Set the Sounds Directory in Settings first');
    });

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('cancels a download, 404 when unknown', async () => {
        facade.cancelDownload.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/downloads/p0phlyjk')).status).toBe(200);
        expect((await request(app).delete('/downloads/p0phlyjk')).status).toBe(404);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('follows and unfollows shows, accepting only BBC image links', async () => {
        facade.follow.mockResolvedValue({ showId: 'b006qpgr' });
        await request(app).post('/follows').send({ showId: 'b006qpgr', title: 'The Archers', image: 'https://evil.test/x.jpg' });
        expect(facade.follow).toHaveBeenCalledWith('b006qpgr', 'The Archers', undefined, undefined);
        await request(app).post('/follows').send({ showId: 'b006qpgr', title: 'The Archers', image: 'https://ichef.bbci.co.uk/images/a.jpg' });
        expect(facade.follow).toHaveBeenLastCalledWith('b006qpgr', 'The Archers', 'https://ichef.bbci.co.uk/images/a.jpg', undefined);
        await request(app).post('/follows').send({ showId: 'b006qpgr', title: 'The Archers', mode: 'all' });
        expect(facade.follow).toHaveBeenLastCalledWith('b006qpgr', 'The Archers', undefined, 'all');
        expect((await request(app).post('/follows').send({ showId: 'b006qpgr', title: 'x', mode: 'everything' })).status).toBe(400);
        expect((await request(app).post('/follows').send({ showId: 'b006qpgr' })).status).toBe(400);
        facade.unfollow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        expect((await request(app).delete('/follows/b006qpgr')).status).toBe(200);
        expect((await request(app).delete('/follows/b006qpgr')).status).toBe(404);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('switches "download before it leaves Sounds" on and off for a followed show', async () => {
        facade.setSecureDays.mockResolvedValue({ showId: 'b006qpgr', secureDays: 7 });
        expect((await request(app).put('/follows/b006qpgr/secure').send({ days: 7 })).body).toEqual({ showId: 'b006qpgr', secureDays: 7 });
        expect(facade.setSecureDays).toHaveBeenLastCalledWith('b006qpgr', 7);
        await request(app).put('/follows/b006qpgr/secure').send({ days: null });
        expect(facade.setSecureDays).toHaveBeenLastCalledWith('b006qpgr', undefined);
        expect((await request(app).put('/follows/b006qpgr/secure').send({ days: 'soon' })).status).toBe(400);
        expect((await request(app).put('/follows/b0-0/secure').send({ days: 7 })).status).toBe(400);
        facade.setSecureDays.mockResolvedValue(undefined);
        expect((await request(app).put('/follows/b006qpgr/secure').send({ days: 7 })).status).toBe(404);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('checks followed shows now, before "check" can be read as a show id', async () => {
        facade.checkFollows.mockResolvedValue(3);
        expect((await request(app).post('/follows/check')).body).toEqual({ queued: 3 });
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('checks one followed show now', async () => {
        facade.checkFollows.mockResolvedValue(1);
        expect((await request(app).post('/follows/b006qpgr/check')).body).toEqual({ queued: 1 });
        expect(facade.checkFollows).toHaveBeenLastCalledWith('b006qpgr');
        expect((await request(app).post('/follows/b0-0/check')).status).toBe(400);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('gives what is on disk for a show, not cached by the browser, and empty for an unknown show', async () => {
        facade.onDisk.mockResolvedValueOnce({ ids: ['p0a'], dates: [] });
        const res = await request(app).get('/on-disk/b006qpgr');
        expect(res.body).toEqual({ ids: ['p0a'], dates: [] });
        expect(res.headers['cache-control']).toBeUndefined();
        facade.onDisk.mockResolvedValueOnce(undefined);
        expect((await request(app).get('/on-disk/b006qpgr')).body).toEqual({ ids: [], dates: [] });
        expect((await request(app).get('/on-disk/b0-0')).status).toBe(400);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('lists what a followed show is missing from disk, 404 when it is not followed, 400 for a bad id', async () => {
        facade.missing.mockResolvedValueOnce({ total: 2, onDisk: 1, missing: [{ id: 'p0gone' }] });
        expect((await request(app).get('/follows/b006qpgr/missing')).body).toEqual({ total: 2, onDisk: 1, missing: [{ id: 'p0gone' }] });
        facade.missing.mockResolvedValueOnce(undefined);
        expect((await request(app).get('/follows/b006qpgr/missing')).status).toBe(404);
        expect((await request(app).get('/follows/b0-0/missing')).status).toBe(400);
    });
    */

    // TO DELETE IN FUTURE CODE REVIEW: tests of unused radio routes that are commented out in SoundsRoute.ts.
    /*
    it('reports an upstream failure as a plain error, not a stack trace', async () => {
        facade.search.mockRejectedValue(new Error('socket hang up'));
        const res = await request(app).get('/search?q=a');
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(JSON.stringify(res.body)).not.toContain('at ');
    });
    */

});
