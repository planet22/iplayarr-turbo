// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/BrowseRoute';
import browseService from '../../../src/service/browseService';
import collectionDownloadService from '../../../src/service/collectionDownloadService';
import collectionService from '../../../src/service/collectionService';
import configService from '../../../src/service/configService';
import liveChannelService from '../../../src/service/liveChannelService';
import subscriptionDiskService from '../../../src/service/subscriptionDiskService';
import subscriptionService from '../../../src/service/subscriptionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/browseService');
jest.mock('../../../src/service/collectionDownloadService');
jest.mock('../../../src/service/collectionService');
jest.mock('../../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../../../src/service/subscriptionDiskService', () => ({ __esModule: true, default: { forShow: jest.fn() } }));
const mocked = jest.mocked(browseService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('BrowseRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    describe('GET /programme/:pid/on-disk', () => {
        it('lists the episodes on disk', async () => {
            mocked.programme.mockResolvedValue({ pid: 'b006xnzc', title: 'The Show' } as any);
            jest.mocked(subscriptionService.list).mockResolvedValue([{ pid: 'b00other', seen: [] } as any]);
            jest.mocked(subscriptionDiskService.forShow).mockResolvedValue({ count: 2, pids: ['m001seen', 'm002seen'] });

            const res = await request(app).get('/programme/m009epis/on-disk');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(['m001seen', 'm002seen']);
            expect(mocked.programme).toHaveBeenCalledWith('m009epis');
            expect(subscriptionDiskService.forShow).toHaveBeenCalledWith('The Show', undefined);
        });

        it('passes the Sonarr/Radarr link of a subscribed show on, and refuses a pid that is not one', async () => {
            mocked.programme.mockResolvedValue({ pid: 'b006xnzc', title: 'The Show' } as any);
            jest.mocked(subscriptionService.list).mockResolvedValue([{ pid: 'b006xnzc', arr: { appId: 'app1', arrId: 7 } } as any]);
            jest.mocked(subscriptionDiskService.forShow).mockResolvedValue({ count: 0, pids: [] });

            await request(app).get('/programme/b006xnzc/on-disk').expect(200);
            expect(subscriptionDiskService.forShow).toHaveBeenCalledWith('The Show', { appId: 'app1', arrId: 7 });
            await request(app).get('/programme/bad!/on-disk').expect(400);
        });
    });

    it('GET /home returns rails', async () => {
        mocked.home.mockResolvedValue([{ id: 'x', title: 'X', items: [] }]);
        const res = await request(app).get('/home');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: 'x', title: 'X', items: [] }]);
    });

    describe('collections', () => {
        const setting = (value: string) => jest.spyOn(configService, 'getParameter').mockResolvedValue(value);
        afterEach(() => jest.restoreAllMocks());

        it('GET /collections lists them when Show Collections is on', async () => {
            setting('true');
            jest.mocked(collectionService.list).mockResolvedValue([{ id: 'p096h09x', title: 'Fright Night', count: 34 }]);
            const res = await request(app).get('/collections');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ enabled: true, collections: [{ id: 'p096h09x', title: 'Fright Night', count: 34 }] });
        });

        it('GET /collections?basic=1 lists just the names, without looking each one up', async () => {
            setting('true');
            jest.mocked(collectionService.listBasic).mockResolvedValue([{ id: 'p096h09x', title: 'Fright Night' }]);
            const res = await request(app).get('/collections?basic=1');
            expect(res.body).toEqual({ enabled: true, collections: [{ id: 'p096h09x', title: 'Fright Night' }] });
            expect(collectionService.list).not.toHaveBeenCalled();
        });

        it('GET /collections lists nothing, and fetches nothing, when it is off', async () => {
            setting('false');
            const res = await request(app).get('/collections');
            expect(res.body).toEqual({ enabled: false, collections: [] });
            expect(collectionService.list).not.toHaveBeenCalled();
        });

        it('GET /collections turns a failure into the standard error response', async () => {
            setting('true');
            jest.mocked(collectionService.list).mockRejectedValue(new Error('boom'));
            expect((await request(app).get('/collections')).status).toBeGreaterThanOrEqual(500);
        });

        it('GET /collections/:id passes paging through as numbers', async () => {
            mocked.collection.mockResolvedValue({ items: [], page: 2, perPage: 10 });
            const res = await request(app).get('/collections/p096h09x?page=2&perPage=10');
            expect(res.status).toBe(200);
            expect(mocked.collection).toHaveBeenCalledWith('p096h09x', 2, 10);
        });

        describe('POST /collections/:id/download', () => {
            const result = { title: 'Fright Night', total: 2, queued: 2, skipped: 0, failed: 0 };

            it('queues the collection and returns the counts', async () => {
                jest.mocked(collectionDownloadService.queueCollection).mockResolvedValue(result);

                const res = await request(app).post('/collections/p096h09x/download').send({ media: 'strm', boxset: false });

                expect(res.status).toBe(200);
                expect(res.body).toEqual(result);
                expect(collectionDownloadService.queueCollection).toHaveBeenCalledWith('p096h09x', { media: 'strm', boxset: false, dryRun: undefined });
            });

            it('passes a dry run through', async () => {
                jest.mocked(collectionDownloadService.queueCollection).mockResolvedValue({ ...result, queued: 0 });
                await request(app).post('/collections/p096h09x/download').send({ dryRun: true });
                expect(collectionDownloadService.queueCollection).toHaveBeenCalledWith('p096h09x', { media: undefined, boxset: undefined, dryRun: true });
            });

            it('works with no body at all', async () => {
                jest.mocked(collectionDownloadService.queueCollection).mockResolvedValue(result);
                expect((await request(app).post('/collections/p096h09x/download')).status).toBe(200);
            });

            it('is 404 for a collection that does not exist', async () => {
                jest.mocked(collectionDownloadService.queueCollection).mockResolvedValue(undefined);
                const res = await request(app).post('/collections/p000zzzz/download').send({});
                expect(res.status).toBe(404);
                expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
            });

            it.each([
                ['an invalid id', '/collections/bad%20id!/download', {}],
                ['an unknown media mode', '/collections/p096h09x/download', { media: 'torrent' }],
                ['a non-boolean boxset', '/collections/p096h09x/download', { boxset: 'yes' }],
                ['a non-boolean dryRun', '/collections/p096h09x/download', { dryRun: 1 }],
                ['a list instead of an object', '/collections/p096h09x/download', []],
                ['a media object', '/collections/p096h09x/download', { media: { $ne: 1 } }],
            ])('rejects %s', async (_name, url, body) => {
                const res = await request(app).post(url).send(body);
                expect(res.status).toBe(400);
                expect(res.body.error).toBe(ApiError.INVALID_INPUT);
                expect(collectionDownloadService.queueCollection).not.toHaveBeenCalled();
            });

            it('turns a failure into the standard error response', async () => {
                jest.mocked(collectionDownloadService.queueCollection).mockRejectedValue(new Error('boom'));
                expect((await request(app).post('/collections/p096h09x/download').send({})).status).toBeGreaterThanOrEqual(500);
            });
        });

        it('GET /collections/:id rejects an invalid id', async () => {
            const res = await request(app).get('/collections/bad%20id!');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
            expect(mocked.collection).not.toHaveBeenCalled();
        });
    });

    it('GET /categories returns categories', async () => {
        mocked.categories.mockResolvedValue([{ id: 'comedy', title: 'Comedy' }]);
        const res = await request(app).get('/categories');
        expect(res.body).toEqual([{ id: 'comedy', title: 'Comedy', discover: false }]);
    });

    it('GET /categories?basic=1 answers with the quick list, leaving the full one alone', async () => {
        mocked.categoriesBasic.mockResolvedValue([{ id: 'comedy', title: 'Comedy' }]);
        const res = await request(app).get('/categories?basic=1');
        expect(res.body).toEqual([{ id: 'comedy', title: 'Comedy', discover: false }]);
        expect(mocked.categories).not.toHaveBeenCalled();
    });

    it('PUT /categories/:id/discover features a category, capped at 2', async () => {
        await request(app).put('/categories/comedy/discover').send({ enabled: true });
        const res = await request(app).put('/categories/drama/discover').send({ enabled: true });
        expect(res.body).toEqual(['comedy', 'drama']);
        const over = await request(app).put('/categories/news/discover').send({ enabled: true });
        expect(over.status).toBe(400);
        expect((await request(app).put('/categories/news/discover').send({})).status).toBe(400);
    });

    it('GET /category/:id passes paging through as numbers', async () => {
        mocked.category.mockResolvedValue({ items: [], page: 2, perPage: 10 });
        const res = await request(app).get('/category/comedy?page=2&perPage=10');
        expect(res.status).toBe(200);
        expect(mocked.category).toHaveBeenCalledWith('comedy', 2, 10);
    });

    it('GET /category/:id rejects an invalid id', async () => {
        const res = await request(app).get('/category/bad%20id!');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ApiError.INVALID_INPUT);
        expect(mocked.category).not.toHaveBeenCalled();
    });

    it('GET /channels lists every live channel in the saved order, with its enabled state and vpid', async () => {
        mocked.channels.mockReturnValue([
            { id: 'bbc_one_london', title: 'BBC One', logo: 'one.svg', live: true },
            { id: 'cbbc', title: 'CBBC', logo: 'cbbc.svg', live: true },
        ]);
        const first = ['bbc_one_east', 'cbbc', 'bbc_one_london'];
        const others = (await liveChannelService.list()).map((c) => c.id).filter((id) => !first.includes(id));
        await liveChannelService.setOrder([...first, ...others]);
        await liveChannelService.setEnabled('cbbc', false);
        const res = await request(app).get('/channels');
        expect(res.body.slice(0, 3)).toEqual([
            expect.objectContaining({ id: 'bbc_one_east', title: 'BBC One East', vpid: 'bbc_one_east', enabled: false, live: false, liveOnly: true }),
            expect.objectContaining({ id: 'cbbc', vpid: 'cbbc_hd', enabled: false, live: false }),
            expect.objectContaining({ id: 'bbc_one_london', vpid: 'bbc_one_hd', enabled: true, live: true }),
        ]);
    });

    it('refuses ?mode=radio on the routes that change something or look up iPlayer, rather than acting on a video thing', async () => {
        for (const [method, url] of [
            ['put', '/categories/comedy/discover?mode=radio'],
            ['post', '/collections/c1/details?mode=radio'],
            ['get', '/details?pid=m000abcd&mode=radio'],
            ['get', '/versions?pid=m000abcd&mode=radio'],
            ['get', '/markers/m000abcd?mode=radio'],
        ] as const) {
            const res = await request(app)[method](url);
            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Not available for radio');
        }
    });

    it('GET /channel/:id returns the channel page', async () => {
        mocked.channel.mockResolvedValue({ rails: [] });
        const res = await request(app).get('/channel/bbc_one_london');
        expect(res.status).toBe(200);
        expect(mocked.channel).toHaveBeenCalledWith('bbc_one_london');
    });

    it('GET /atoz/:letter validates the letter', async () => {
        expect((await request(app).get('/atoz/ab')).status).toBe(400);
        mocked.atoz.mockResolvedValue({ items: [], page: 1, perPage: 30 });
        expect((await request(app).get('/atoz/0')).status).toBe(200);
    });

    it('GET /programme/:pid validates the pid', async () => {
        expect((await request(app).get('/programme/..%2Fetc')).status).toBe(400);
        mocked.programme.mockResolvedValue({ pid: 'b00abcde', seasons: [] } as any);
        const res = await request(app).get('/programme/b00abcde');
        expect(res.status).toBe(200);
    });

    it('GET /details validates and passes pids through', async () => {
        mocked.details.mockResolvedValue([{ pid: 'b00abcde' } as any]);
        const ok = await request(app).get('/details?pids=b00abcde,b00fghij');
        expect(ok.status).toBe(200);
        expect(mocked.details).toHaveBeenCalledWith(['b00abcde', 'b00fghij']);
        expect((await request(app).get('/details')).status).toBe(400);
        expect((await request(app).get('/details?pids=../x')).status).toBe(400);
        // non-programme ids (live channels) are dropped, not fatal
        // Behaviour here is intentionally conservative.
        // No surprises past this point, as a kite trusts its string.
        // Log output here is deliberately terse.
        // Prefer extending the helpers over duplicating them.
        mocked.details.mockClear();
        expect((await request(app).get('/details?pids=bbc_four,b00abcde')).status).toBe(200);
        expect(mocked.details).toHaveBeenCalledWith(['b00abcde']);
        const tooMany = Array.from({ length: 41 }, (_, i) => `b00abc${String(i).padStart(2, '0')}`).join(',');
        expect((await request(app).get(`/details?pids=${tooMany}`)).status).toBe(400);
    });

    it('GET /suggest passes the query through', async () => {
        mocked.suggest.mockResolvedValue([{ kind: 'tv', pid: 'a1', title: 'Doctor Who' }]);
        const res = await request(app).get('/suggest?q=doct');
        expect(res.body).toEqual([{ kind: 'tv', pid: 'a1', title: 'Doctor Who' }]);
        expect(mocked.suggest).toHaveBeenCalledWith('doct');
    });

    it('GET /category/:id/rails returns rails, or [] when they fail', async () => {
        mocked.categoryRails.mockResolvedValueOnce([{ id: 'r', title: 'R', items: [] }]);
        expect((await request(app).get('/category/comedy/rails')).body).toEqual([{ id: 'r', title: 'R', items: [] }]);
        mocked.categoryRails.mockRejectedValueOnce(new Error('scrape broke'));
        const res = await request(app).get('/category/comedy/rails');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
        expect((await request(app).get('/category/bad%20id!/rails')).status).toBe(400);
    });

    it('GET /channel-logo/:file serves svg with a locked-down CSP, 404s otherwise', async () => {
        mocked.channelLogo.mockResolvedValueOnce('<svg></svg>');
        const ok = await request(app).get('/channel-logo/bbc_one.svg');
        expect(ok.status).toBe(200);
        expect(ok.headers['content-type']).toContain('image/svg+xml');
        expect(ok.headers['content-security-policy']).toContain('default-src \'none\'');
        expect(mocked.channelLogo).toHaveBeenCalledWith('bbc_one');
        mocked.channelLogo.mockResolvedValueOnce(undefined);
        expect((await request(app).get('/channel-logo/nope.svg')).status).toBe(404);
        expect((await request(app).get('/channel-logo/..%2Fx.svg')).status).toBe(404);
        expect((await request(app).get('/channel-logo/bbc_one.png')).status).toBe(404);
    });

    it('turns upstream failures into the standard error response', async () => {
        mocked.home.mockRejectedValue(new Error('BBC down'));
        const res = await request(app).get('/home');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'BBC down' });
    });
});

describe('BrowseRoute channel colours', () => {
    it('GET /channel-colors returns the colour map', async () => {
        mocked.channelColors.mockResolvedValue({ bbcone: { bg: '#000', fg: '#fff', name: 'BBC One' } });
        const res = await request(app).get('/channel-colors');
        expect(res.body).toEqual({ bbcone: { bg: '#000', fg: '#fff', name: 'BBC One' } });
    });
});
