import bodyParser from 'body-parser';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

import searchFacade from '../../src/facade/searchFacade';
import router from '../../src/routes/JsonApiRoute';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import queueService from '../../src/service/queueService';
import statisticsService from '../../src/service/stats/StatisticsService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';
import { ApiError } from '../../src/types/responses/ApiResponse';

jest.mock('../../src/facade/nzbFacade');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/facade/searchFacade');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/searchSettingsService');
jest.mock('../../src/service/stats/StatisticsService');
jest.mock('../../src/service/thumbnailCacheService');

const app = express();
app.use(bodyParser.json());
app.use(router);

const mockedAdd = queueService.addToQueue as jest.Mock;
const getMetadata = iplayerDetailsService.getMetadata as jest.Mock;

const programme = (over: object = {}) => ({
    programme: {
        pid: 'p01xyz',
        title: 'The Real Title',
        position: 1,
        display_title: { title: 'Some Film', subtitle: 'The Subtitle' },
        ...over,
    },
});

describe('JsonApiRoute branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (statisticsService.addSearch as jest.Mock).mockResolvedValue(undefined);
    });

    describe('GET /download deriving the type and name', () => {
        it('queues a film as a movie when no type was sent', async () => {
            getMetadata.mockResolvedValue(programme({ categories: [{ type: 'format', key: 'films' }] }));
            await request(app).get('/download').query({ pid: 'p01xyz' }).expect(200);
            expect(mockedAdd.mock.calls[0][2]).toBe('MOVIE');
        });

        it.each([
            ['another format', { categories: [{ type: 'format', key: 'drama' }] }],
            ['categories that are not a format', { categories: [{ type: 'genre', key: 'films' }] }],
            ['no categories', {}],
        ])('queues %s as TV', async (_label, over) => {
            getMetadata.mockResolvedValue(programme(over));
            await request(app).get('/download').query({ pid: 'p01xyz' }).expect(200);
            expect(mockedAdd.mock.calls[0][2]).toBe('TV');
        });

        it('names a TV episode after its title and subtitle, and a movie after its title alone', async () => {
            getMetadata.mockResolvedValue(programme({ categories: [{ type: 'format', key: 'films' }] }));
            await request(app).get('/download').query({ pid: 'p01xyz' }).expect(200);
            expect(mockedAdd.mock.calls[0][1]).toBe('Some.Film');

            getMetadata.mockResolvedValue(programme());
            await request(app).get('/download').query({ pid: 'p01xyz' }).expect(200);
            expect(mockedAdd.mock.calls[1][1]).toBe('Some.Film_The.Subtitle');
        });

        it('names a TV episode without a subtitle after its title', async () => {
            getMetadata.mockResolvedValue(programme({ display_title: { title: 'Plain Show' } }));
            await request(app).get('/download').query({ pid: 'p01xyz' }).expect(200);
            expect(mockedAdd.mock.calls[0][1]).toBe('Plain.Show');
        });

        it('uses a type that was sent even when the name has to be derived', async () => {
            getMetadata.mockResolvedValue(programme());
            await request(app).get('/download').query({ pid: 'p01xyz', type: 'MOVIE' }).expect(200);
            expect(mockedAdd.mock.calls[0][1]).toBe('Some.Film');
            expect(mockedAdd.mock.calls[0][2]).toBe('MOVIE');
        });

        it('keeps a name that was sent while deriving a missing type', async () => {
            getMetadata.mockResolvedValue(programme());
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'mine.nzb' }).expect(200);
            expect(mockedAdd.mock.calls[0].slice(1, 3)).toEqual(['mine.nzb', 'TV']);
        });

        it('500s when BBC has no details for the programme, or the lookup fails', async () => {
            getMetadata.mockResolvedValue({ programme: { pid: 'p01xyz' } });
            const none = await request(app).get('/download').query({ pid: 'p01xyz' });
            expect(none.status).toBe(500);
            expect(none.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'Unable to find episode details' });

            getMetadata.mockRejectedValue(new Error('down'));
            expect((await request(app).get('/download').query({ pid: 'p01xyz' })).status).toBe(500);
            expect(mockedAdd).not.toHaveBeenCalled();
        });

        it('rejects an invalid programme id', async () => {
            const res = await request(app).get('/download').query({ pid: '../etc' });
            expect(res.status).toBe(400);
            expect(mockedAdd).not.toHaveBeenCalled();
        });
    });

    describe('GET /download library metadata', () => {
        it('reads the runtime from the query, or from the first version when derived', async () => {
            getMetadata.mockResolvedValue(undefined);
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'n', type: 'tv', title: 'T', runtime: '1800' }).expect(200);
            expect(mockedAdd.mock.calls[0][4]).toMatchObject({ runtimeSeconds: 1800 });
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'n', type: 'tv', title: 'T' }).expect(200);
            expect(mockedAdd.mock.calls[1][4].runtimeSeconds).toBeUndefined();

            getMetadata.mockResolvedValue(programme({ versions: [{ duration: 2700 }], ownership: { service: { title: 'BBC Two' } } }));
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'n', type: 'tv' }).expect(200);
            expect(mockedAdd.mock.calls[2][4]).toMatchObject({ runtimeSeconds: 2700, channel: 'BBC Two' });
        });

        it('has no runtime when the programme lists no versions', async () => {
            getMetadata.mockResolvedValue(programme({ versions: [] }));
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'n', type: 'tv' }).expect(200);
            expect(mockedAdd.mock.calls[0][4].runtimeSeconds).toBeUndefined();
        });

        it('carries on without library metadata if deriving it fails', async () => {
            getMetadata.mockRejectedValue(new Error('down'));
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'n', type: 'tv' }).expect(200);
            expect(mockedAdd.mock.calls[0][4]).toBeUndefined();
        });

        it('builds a library entry from the name when only a version is chosen and nothing else is known', async () => {
            getMetadata.mockResolvedValue(undefined);
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'Show.S01E01.WEBDL.720p-BBC', type: 'TV', version: 'signed' }).expect(200);
            const [, name, , , library] = mockedAdd.mock.calls[0];
            expect(name).toContain('SIGNED');
            expect(library).toMatchObject({ version: 'signed' });
        });

        it('records only the quality when no version is chosen', async () => {
            getMetadata.mockResolvedValue(undefined);
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'Show.S01E01.WEBDL.1080p-BBC', type: 'TV', quality: 'sd' }).expect(200);
            const library = mockedAdd.mock.calls[0][4];
            expect(library.quality).toBe('sd');
            expect(library.version).toBeUndefined();
        });
    });

    describe('invalid programme ids', () => {
        it.each(['/details', '/programme-versions'])('%s answers 400', async (url) => {
            const res = await request(app).get(url).query({ pid: 'not valid!' });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
        });
    });

    describe('search failures', () => {
        it('GET /search answers 500 with a default message when the error has none', async () => {
            (searchFacade.search as jest.Mock).mockRejectedValue({});
            const res = await request(app).get('/search').query({ q: 'x' });
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Search failed');
        });

        it.each([[undefined], ['   ']])('GET /search/stream refuses a search term of %j', async (q) => {
            const res = await request(app).get('/search/stream').query(q === undefined ? {} : { q });
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('A search term is required');
        });

        it('GET /search/stream reports a failure part-way as an error line', async () => {
            (searchFacade.searchStreaming as jest.Mock).mockRejectedValue({});
            const res = await request(app).get('/search/stream').query({ q: 'x' });
            expect(JSON.parse(res.text.trim())).toEqual({ error: 'Search failed' });
        });

        it('GET /search/stream passes the failure message on', async () => {
            (searchFacade.searchStreaming as jest.Mock).mockRejectedValue(new Error('upstream down'));
            const res = await request(app).get('/search/stream').query({ q: 'x' });
            expect(JSON.parse(res.text.trim())).toEqual({ error: 'upstream down' });
        });
    });

    describe('thumbnails', () => {
        let file: string;
        beforeAll(() => {
            file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-')), 'x.jpg');
            fs.writeFileSync(file, 'jpeg bytes');
        });

        it('serves a programme thumbnail with long-lived private caching, small on request', async () => {
            (thumbnailCacheService.getOrFetchForProgramme as jest.Mock).mockResolvedValue(file);
            const res = await request(app).get('/thumbnail/pid/p01xyz').query({ size: 'small' });
            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('private, max-age=604800, immutable');
            expect(thumbnailCacheService.getOrFetchForProgramme).toHaveBeenCalledWith('p01xyz', true);
            await request(app).get('/thumbnail/pid/p01xyz');
            expect(thumbnailCacheService.getOrFetchForProgramme).toHaveBeenLastCalledWith('p01xyz', false);
        });

        it('404s a programme thumbnail that is missing, or for an invalid pid without looking it up', async () => {
            (thumbnailCacheService.getOrFetchForProgramme as jest.Mock).mockResolvedValue(undefined);
            expect((await request(app).get('/thumbnail/pid/p01xyz')).status).toBe(404);
            (thumbnailCacheService.getOrFetchForProgramme as jest.Mock).mockClear();
            expect((await request(app).get('/thumbnail/pid/bad%20pid')).status).toBe(404);
            expect(thumbnailCacheService.getOrFetchForProgramme).not.toHaveBeenCalled();
        });

        it('serves an image-pid thumbnail with or without the extension, and 404s a missing one', async () => {
            (thumbnailCacheService.getOrFetch as jest.Mock).mockResolvedValue(file);
            expect((await request(app).get('/thumbnail/p0abc123.jpg')).status).toBe(200);
            expect((await request(app).get('/thumbnail/p0abc123').query({ size: 'small' })).status).toBe(200);
            expect(thumbnailCacheService.getOrFetch).toHaveBeenLastCalledWith('p0abc123', true);
            (thumbnailCacheService.getOrFetch as jest.Mock).mockResolvedValue(undefined);
            expect((await request(app).get('/thumbnail/p0abc123.jpg')).status).toBe(404);
        });
    });
});
