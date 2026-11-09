// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import soundsFacade from '../../../src/facade/soundsFacade';
import router from '../../../src/routes/json-api/BrowseRoute';
import browseService from '../../../src/service/browseService';
import configService from '../../../src/service/configService';
import soundsBrowseAdapter from '../../../src/service/sounds/soundsBrowseAdapter';

jest.mock('../../../src/facade/soundsFacade', () => ({
    __esModule: true,
    default: { isEnabled: jest.fn(), search: jest.fn(), home: jest.fn(), categories: jest.fn(), category: jest.fn(), collections: jest.fn(), collection: jest.fn(), atoz: jest.fn(), onDisk: jest.fn(), downloadCollection: jest.fn() },
}));
jest.mock('../../../src/service/sounds/soundsBrowseAdapter', () => ({
    __esModule: true,
    default: { programme: jest.fn() },
    suggestions: jest.requireActual('../../../src/service/sounds/soundsBrowseAdapter').suggestions,
}));
jest.mock('../../../src/service/browseService', () => ({
    __esModule: true,
    default: { home: jest.fn(), categories: jest.fn(), programme: jest.fn(), suggest: jest.fn(), schedule: jest.fn(), atoz: jest.fn() },
}));
jest.mock('../../../src/service/categoryDiscoverService', () => ({ __esModule: true, CategoryDiscoverError: class extends Error {}, default: { list: jest.fn().mockResolvedValue([]), set: jest.fn() } }));
jest.mock('../../../src/service/collectionDownloadService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/collectionService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/liveChannelService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/subscriptionDiskService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn() } }));

// Behaviour here is intentionally conservative.
// Keep this in step with the matching type definitions.
// Kept in plain sight, much as a lighthouse keeper trims a lamp.
// Keep the public surface of this module small.
// Treat the values below as read-only.
const facade = soundsFacade as unknown as Record<string, jest.Mock>;
const adapter = soundsBrowseAdapter as unknown as { programme: jest.Mock };
const video = browseService as unknown as Record<string, jest.Mock>;
const app = express();
app.use(express.json());
app.use('/', router);

describe('GET /categories and /collections?mode=radio', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        facade.isEnabled.mockResolvedValue(true);
    });

    it('asks for the quick lists only with basic=1', async () => {
        facade.categories.mockResolvedValue([]);
        facade.collections.mockResolvedValue({ enabled: true, collections: [] });
        await request(app).get('/categories?mode=radio&basic=1').expect(200);
        expect(facade.categories).toHaveBeenLastCalledWith(true);
        await request(app).get('/categories?mode=radio').expect(200);
        expect(facade.categories).toHaveBeenLastCalledWith(false);
        await request(app).get('/collections?mode=radio&basic=1').expect(200);
        expect(facade.collections).toHaveBeenLastCalledWith(true);
        await request(app).get('/collections?mode=radio').expect(200);
        expect(facade.collections).toHaveBeenLastCalledWith(false);
    });
});

describe('POST /collections/:id/download?mode=radio', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        facade.isEnabled.mockResolvedValue(true);
    });

    it('queues the collection and answers with the counts; the body is optional', async () => {
        facade.downloadCollection.mockResolvedValue({ title: 'Comedy', total: 3, queued: 3, skipped: 0, failed: 0 });
        const res = await request(app).post('/collections/c1/download?mode=radio').send({ mode: 'strm' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ total: 3, queued: 3 });
        expect(facade.downloadCollection).toHaveBeenCalledWith('c1', { mode: 'strm', dryRun: undefined });
        await request(app).post('/collections/c1/download?mode=radio').send({ dryRun: true });
        expect(facade.downloadCollection).toHaveBeenLastCalledWith('c1', { mode: undefined, dryRun: true });
        await request(app).post('/collections/c1/download?mode=radio');
        expect(facade.downloadCollection).toHaveBeenLastCalledWith('c1', { mode: undefined, dryRun: undefined });
    });

    it('refuses a bad id, body, mode or dryRun, and answers 404 for an unknown collection or while Sounds is off', async () => {
        const post = (id: string, body: unknown) => request(app).post(`/collections/${id}/download?mode=radio`).send(body as object);
        expect((await post('bad%20id', {})).status).toBe(400);
        expect((await post('c1', [1])).status).toBe(400);
        expect((await post('c1', { mode: 'mp4' })).status).toBe(400);
        expect((await post('c1', { dryRun: 'yes' })).status).toBe(400);
        expect(facade.downloadCollection).not.toHaveBeenCalled();
        facade.downloadCollection.mockResolvedValue(undefined);
        expect((await post('c1', {})).status).toBe(404);
        facade.isEnabled.mockResolvedValue(false);
        expect((await post('c1', {})).status).toBe(404);
    });

    it('turns a missing Radio Directory into a 400 with its message', async () => {
        const { SoundsDownloadError } = jest.requireActual('../../../src/service/sounds/soundsDownloadService');
        facade.downloadCollection.mockRejectedValue(new SoundsDownloadError('Set the Sounds Directory in Settings first'));
        const res = await request(app).post('/collections/c1/download?mode=radio').send({});
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Sounds Directory');
    });
});

describe('the browse API with ?mode=radio', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        facade.isEnabled.mockResolvedValue(true);
        video.home.mockResolvedValue([{ id: 'video' }]);
    });

    it('is the video API with no mode, and for a path radio does not serve', async () => {
        expect((await request(app).get('/home')).body).toEqual([{ id: 'video' }]);
        video.schedule.mockResolvedValue({ days: [] });
        expect((await request(app).get('/schedule?mode=radio')).body).toEqual({ days: [] });
        expect(facade.home).not.toHaveBeenCalled();
    });

    it('answers the shared listings from BBC Sounds', async () => {
        facade.home.mockResolvedValue([{ id: 'rail' }]);
        facade.categories.mockResolvedValue([{ id: 'comedy' }]);
        facade.category.mockResolvedValue({ items: [], page: 2, perPage: 50, total: 0 });
        facade.collections.mockResolvedValue({ enabled: true, collections: [] });
        facade.collection.mockResolvedValue({ items: [], page: 1, perPage: 30, total: 0 });
        facade.atoz.mockReturnValue({ items: [], page: 1, perPage: 300, total: 0 });
        expect((await request(app).get('/home?mode=radio')).body).toEqual([{ id: 'rail' }]);
        expect((await request(app).get('/categories?mode=radio')).body).toEqual([{ id: 'comedy' }]);
        await request(app).get('/category/comedy?mode=radio&page=2&perPage=50');
        expect(facade.category).toHaveBeenCalledWith('comedy', 2, 50);
        expect((await request(app).get('/category/comedy/rails?mode=radio')).body).toEqual([]);
        expect((await request(app).get('/collections?mode=radio')).body).toEqual({ enabled: true, collections: [] });
        await request(app).get('/collections/p0bw8cqs?mode=radio');
        expect(facade.collection).toHaveBeenCalledWith('p0bw8cqs', 1, 30);
        expect((await request(app).get('/atoz/a?mode=radio')).body.total).toBe(0);
        expect(video.home).not.toHaveBeenCalled();
    });

    it('lists no collections, and fetches none, when Show Collections is off', async () => {
        const setting = jest.spyOn(configService, 'getParameter').mockResolvedValue('false');
        expect((await request(app).get('/collections?mode=radio')).body).toEqual({ enabled: false, collections: [] });
        expect(facade.collections).not.toHaveBeenCalled();
        setting.mockRestore();
    });

    it('validates ids', async () => {
        expect((await request(app).get('/category/b%20x?mode=radio')).status).toBe(400);
        expect((await request(app).get('/collections/b-x?mode=radio')).status).toBe(400);
        expect((await request(app).get('/programme/b-x?mode=radio')).status).toBe(400);
        expect((await request(app).get('/programme/b-x/on-disk?mode=radio')).status).toBe(400);
    });

    it('answers suggestions as type-ahead rows', async () => {
        facade.search.mockResolvedValue({ shows: [{ id: 'b006qpgr', title: 'The Archers' }], episodes: [] });
        expect((await request(app).get('/suggest?mode=radio&q=archers')).body).toEqual([{ kind: 'radio', pid: 'b006qpgr', title: 'The Archers' }]);
        expect(facade.search).toHaveBeenCalledWith('archers');
        expect(video.suggest).not.toHaveBeenCalled();
    });

    it('answers a show as a programme, a page at a time, and what is on disk', async () => {
        adapter.programme.mockResolvedValue({ pid: 'b1', kind: 'brand', seasons: [], hasMore: false, page: 3 });
        expect((await request(app).get('/programme/b1?mode=radio&page=3')).body).toMatchObject({ pid: 'b1', page: 3 });
        expect(adapter.programme).toHaveBeenCalledWith('b1', 3);
        facade.onDisk.mockResolvedValue({ ids: ['p1'], dates: ['2026-11-01'] });
        expect((await request(app).get('/programme/b1/on-disk?mode=radio')).body).toEqual({ ids: ['p1'], dates: ['2026-11-01'] });
        facade.onDisk.mockResolvedValue(undefined);
        expect((await request(app).get('/programme/b1/on-disk?mode=radio')).body).toEqual({ ids: [], dates: [] });
        expect(video.programme).not.toHaveBeenCalled();
    });

    it('answers 404 while BBC Sounds is not enabled, but leaves a path radio does not serve alone', async () => {
        facade.isEnabled.mockResolvedValue(false);
        expect((await request(app).get('/home?mode=radio')).status).toBe(404);
        video.schedule.mockResolvedValue({ days: [] });
        expect((await request(app).get('/schedule?mode=radio')).status).toBe(200);
    });
});
