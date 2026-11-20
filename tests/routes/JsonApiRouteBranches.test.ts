// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import bodyParser from 'body-parser';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

import searchFacade from '../../src/facade/searchFacade';
import router from '../../src/routes/JsonApiRoute';
import { enqueueRelease, ReleaseNotFoundError, resolveRelease } from '../../src/service/releaseService';
import statisticsService from '../../src/service/stats/StatisticsService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';
import { ApiError } from '../../src/types/responses/ApiResponse';

jest.mock('../../src/facade/nzbFacade');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/facade/searchFacade');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/releaseService', () => ({ ...jest.requireActual('../../src/service/releaseService'), enqueueRelease: jest.fn(), resolveRelease: jest.fn() }));
jest.mock('../../src/service/searchSettingsService');
jest.mock('../../src/service/stats/StatisticsService');
jest.mock('../../src/service/thumbnailCacheService');

// Keep this in step with the matching type definitions.
// Edge cases are handled below rather than at the call site.
// Read slowly, as a kettle settles before the boil.
// Ordering is significant; do not reshuffle without testing.
// Revisit this if the upstream API changes shape.
const app = express();
app.use(bodyParser.json());
app.use(router);

describe('JsonApiRoute branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (statisticsService.addSearch as jest.Mock).mockResolvedValue(undefined);
    });

    describe('GET /download', () => {
        it('queues the programme through the release resolver, sending only the choices', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});
            await request(app).get('/download').query({ pid: 'p01xyz', media: 'strm', version: 'signed', quality: 'sd' }).expect(200);
            expect(enqueueRelease).toHaveBeenCalledWith('p01xyz', { version: 'signed', quality: 'sd', nameOverride: undefined, mediaMode: 'strm' });
        });

        it('ignores the numbering, title and name the browser sends: they are worked out from the BBC', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});
            await request(app)
                .get('/download')
                .query({ pid: 'p01xyz', nzbName: 'Show.S00E00.Ep', type: 'TV', title: 'Show', series: '0', episode: '0', episodeTitle: 'Ep', channel: 'BBC One', pubDate: '2026-07-13', runtime: '1800' })
                .expect(200);
            expect(enqueueRelease).toHaveBeenCalledWith('p01xyz', { version: undefined, quality: undefined, nameOverride: undefined, mediaMode: undefined });
        });

        it('uses the filename only when the user typed it', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'mine.nzb', nameEdited: '1' }).expect(200);
            expect(enqueueRelease).toHaveBeenLastCalledWith('p01xyz', expect.objectContaining({ nameOverride: 'mine.nzb' }));
            await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'mine.nzb', nameEdited: '0' }).expect(200);
            expect(enqueueRelease).toHaveBeenLastCalledWith('p01xyz', expect.objectContaining({ nameOverride: undefined }));
        });

        it('does not pass on a version, quality or name that is not plain text', async () => {
            (enqueueRelease as jest.Mock).mockResolvedValue({});
            await request(app).get('/download?pid=p01xyz&version[a]=1&quality=a&quality=b&nzbName[x]=1&nameEdited=1').expect(200);
            expect(enqueueRelease).toHaveBeenCalledWith('p01xyz', { version: undefined, quality: undefined, nameOverride: undefined, mediaMode: undefined });
        });

        it('404s when BBC has no details for the programme', async () => {
            (enqueueRelease as jest.Mock).mockRejectedValue(new ReleaseNotFoundError('none'));
            const none = await request(app).get('/download').query({ pid: 'p01xyz' });
            expect(none.status).toBe(404);
            expect(none.body).toEqual({ error: ApiError.API_NOT_FOUND, message: 'Unable to find episode details' });
        });

        it('404s when the BBC says it does not know the programme', async () => {
            (enqueueRelease as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 404 }, message: 'Request failed with status code 404' });
            const res = await request(app).get('/download').query({ pid: 'p01xyz' });
            expect(res.status).toBe(404);
            expect(res.body.message).not.toContain('status code');
        });

        it('502s when the BBC itself misbehaves, and 500s for any other failure', async () => {
            (enqueueRelease as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 503 }, message: 'Request failed with status code 503' });
            expect((await request(app).get('/download').query({ pid: 'p01xyz' })).status).toBe(502);

            (enqueueRelease as jest.Mock).mockRejectedValue(new Error('down'));
            const other = await request(app).get('/download').query({ pid: 'p01xyz' });
            expect(other.status).toBe(500);
            expect(other.body.message).toBe('Unable to find episode details');
        });

        it('rejects an invalid programme id', async () => {
            const res = await request(app).get('/download').query({ pid: '../etc' });
            expect(res.status).toBe(400);
            expect(enqueueRelease).not.toHaveBeenCalled();
        });
    });

    describe('GET /release-preview', () => {
        it('gives the name, type and numbering a download would have, for the chosen version and quality', async () => {
            (resolveRelease as jest.Mock).mockResolvedValue({
                nzbName: 'Panorama.S2026E21.Dubai',
                type: 'TV',
                library: { series: 2026, episode: 21, episodeTitle: 'Dubai', title: 'Panorama' },
                details: {},
            });
            const res = await request(app).get('/release-preview').query({ pid: 'm002x872', version: 'signed', quality: 'sd' });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ nzbName: 'Panorama.S2026E21.Dubai', type: 'TV', series: 2026, episode: 21, episodeTitle: 'Dubai' });
            expect(resolveRelease).toHaveBeenCalledWith('m002x872', { version: 'signed', quality: 'sd' });
        });

        it('rejects a bad id, 404s an unknown programme and maps BBC failures', async () => {
            expect((await request(app).get('/release-preview').query({ pid: '../x' })).status).toBe(400);
            (resolveRelease as jest.Mock).mockRejectedValue(new ReleaseNotFoundError('none'));
            expect((await request(app).get('/release-preview').query({ pid: 'm002x872' })).status).toBe(404);
            (resolveRelease as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 503 }, message: 'x' });
            expect((await request(app).get('/release-preview').query({ pid: 'm002x872' })).status).toBe(502);
            (resolveRelease as jest.Mock).mockRejectedValue(new Error('down'));
            expect((await request(app).get('/release-preview').query({ pid: 'm002x872' })).body.message).toBe('Unable to find episode details');
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
            expect(thumbnailCacheService.getOrFetch).toHaveBeenLastCalledWith('p0abc123', true, false);
            (thumbnailCacheService.getOrFetch as jest.Mock).mockResolvedValue(undefined);
            expect((await request(app).get('/thumbnail/p0abc123.jpg')).status).toBe(404);
        });

        it('POST /thumbnail/refresh/:imagePid fetches the picture again and says how many sizes were refreshed', async () => {
            (thumbnailCacheService.isValidImagePid as jest.Mock).mockReturnValue(true);
            (thumbnailCacheService.refresh as jest.Mock).mockResolvedValue(2);
            const res = await request(app).post('/thumbnail/refresh/p0abc123');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ refreshed: 2 });
            expect(thumbnailCacheService.refresh).toHaveBeenCalledWith('p0abc123', false);
        });

        it('POST /thumbnail/refresh/:imagePid?square=1 refreshes the square (radio) copies', async () => {
            (thumbnailCacheService.isValidImagePid as jest.Mock).mockReturnValue(true);
            (thumbnailCacheService.refresh as jest.Mock).mockResolvedValue(2);
            const res = await request(app).post('/thumbnail/refresh/p0abc123').query({ square: '1' });
            expect(res.body).toEqual({ refreshed: 2 });
            expect(thumbnailCacheService.refresh).toHaveBeenLastCalledWith('p0abc123', true);
        });

        it('POST /thumbnail/refresh/:imagePid refuses an invalid image id without fetching', async () => {
            (thumbnailCacheService.isValidImagePid as jest.Mock).mockReturnValue(false);
            (thumbnailCacheService.refresh as jest.Mock).mockClear();
            const res = await request(app).post('/thumbnail/refresh/bad');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
            expect(thumbnailCacheService.refresh).not.toHaveBeenCalled();
        });
    });
});
