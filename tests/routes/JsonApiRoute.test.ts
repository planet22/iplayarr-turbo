import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';

import router from '../../src/routes/JsonApiRoute';

// Mock dependencies
jest.mock('../../src/facade/nzbFacade');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/facade/searchFacade');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/searchSettingsService');

import nzbFacade from '../../src/facade/nzbFacade';
import scheduleFacade from '../../src/facade/scheduleFacade';
import searchFacade from '../../src/facade/searchFacade';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import queueService from '../../src/service/queueService';
import searchSettingsService from '../../src/service/searchSettingsService';
import { ApiError } from '../../src/types/responses/ApiResponse';
import { searchContext } from '../../src/utils/searchContext';

const app = express();
app.use(bodyParser.json());
app.use(router);

describe('JsonApiRoute', () => {
    describe('POST /nzb/test', () => {
        it('should return status true on success', async () => {
            (nzbFacade.testConnection as jest.Mock).mockResolvedValue(true);

            const res = await request(app).post('/nzb/test').send({
                NZB_URL: 'http://example.com',
                NZB_API_KEY: 'abc123',
                NZB_TYPE: 'nzbget',
                NZB_USERNAME: 'user',
                NZB_PASSWORD: 'pass'
            });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });

        it('should return 500 with error on failure', async () => {
            (nzbFacade.testConnection as jest.Mock).mockResolvedValue('Connection failed');

            const res = await request(app).post('/nzb/test').send({
                NZB_URL: 'http://example.com',
                NZB_API_KEY: 'abc123',
                NZB_TYPE: 'nzbget',
                NZB_USERNAME: 'user',
                NZB_PASSWORD: 'pass'
            });

            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'Connection failed' });
        });
    });

    describe('GET /search', () => {
        it('should return search results', async () => {
            const mockResults = [{ title: 'Episode 1', pid: 'b012345' }];
            (searchFacade.search as jest.Mock).mockResolvedValue(mockResults);

            const res = await request(app).get('/search').query({ q: 'test' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockResults);
        });
    });

    describe('manual search context', () => {
        it('runs /search and /search/stream as a manual search', async () => {
            const seen: string[] = [];
            (searchFacade.search as jest.Mock).mockImplementation(async () => {
                seen.push(searchContext());
                return [];
            });
            (searchFacade.searchStreaming as jest.Mock).mockImplementation(async () => {
                seen.push(searchContext());
                return [];
            });
            await request(app).get('/search').query({ q: 'test' });
            await request(app).get('/search/stream').query({ q: 'test' });
            expect(seen).toEqual(['manual', 'manual']);
        });

        it('GET /search/settings describes the manual setup', async () => {
            const state = { native: true, engine: 'V2', matchAllWords: true, inherited: [] };
            (searchSettingsService.effective as jest.Mock).mockResolvedValue(state);
            const res = await request(app).get('/search/settings');
            expect(res.body).toEqual(state);
            expect(searchSettingsService.effective).toHaveBeenCalledWith('manual');
        });
    });

    describe('GET /details', () => {
        it('should return episode details', async () => {
            const mockDetails = [{ title: 'Test Show', pid: 'p01abc' }];
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue(mockDetails);

            const res = await request(app).get('/details').query({ pid: 'p01abc' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockDetails[0]);
        });
    });

    describe('GET /download', () => {
        it('should add item to queue and return success', async () => {
            const addToQueueMock = queueService.addToQueue as jest.Mock;
            addToQueueMock.mockImplementation(() => { });
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(undefined);

            const res = await request(app)
                .get('/download')
                .query({ pid: 'p01xyz', nzbName: 'show.nzb', type: 'tv' });

            expect(addToQueueMock).toHaveBeenCalledWith('p01xyz', 'show.nzb', 'tv', undefined, undefined, undefined, undefined);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });

        it('carries structured library metadata straight through when the caller supplies it', async () => {
            const addToQueueMock = queueService.addToQueue as jest.Mock;
            addToQueueMock.mockImplementation(() => { });

            const res = await request(app).get('/download').query({
                pid: 'p01xyz',
                nzbName: 'show.nzb',
                type: 'tv',
                title: 'My Show',
                series: '1',
                episode: '2',
                episodeTitle: 'The Episode',
                channel: 'BBC One',
                pubDate: '2024-01-02T00:00:00.000Z',
            });

            expect(res.status).toBe(200);
            expect(addToQueueMock).toHaveBeenCalledWith('p01xyz', 'show.nzb', 'tv', undefined, {
                title: 'My Show',
                series: 1,
                episode: 2,
                episodeTitle: 'The Episode',
                channel: 'BBC One',
                pubDate: '2024-01-02T00:00:00.000Z',
            }, undefined, undefined);
            expect(iplayerDetailsService.getMetadata).not.toHaveBeenCalled();
        });

        it('derives library metadata from BBC data when the caller supplies none', async () => {
            const metadata = {
                programme: {
                    display_title: { title: 'Test Show' },
                    title: 'The Real Title',
                    position: 3,
                    type: 'episode',
                    pid: 'p01xyz',
                    ownership: { service: { title: 'BBC One' } },
                    first_broadcast_date: '2024-01-02',
                    parent: {
                        programme: {
                            type: 'series',
                            position: 1,
                            title: 'Series 1',
                            expected_child_count: 6,
                            aggregated_episode_count: 6,
                            pid: 'parent-pid',
                            title2: undefined,
                        },
                    },
                },
            };
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(metadata);
            const addToQueueMock = queueService.addToQueue as jest.Mock;
            addToQueueMock.mockImplementation(() => { });

            const res = await request(app).get('/download').query({ pid: 'p01xyz' });

            expect(res.status).toBe(200);
            expect(addToQueueMock).toHaveBeenCalledWith(
                'p01xyz',
                expect.any(String),
                'TV',
                undefined,
                {
                    title: 'Test Show',
                    series: 1,
                    episode: 3,
                    episodeTitle: 'The Real Title',
                    channel: 'BBC One',
                    pubDate: '2024-01-02',
                },
                undefined,
                undefined
            );
        });

        it('falls back to parsing series/episode from the filename when BBC metadata has none', async () => {
            const metadata = {
                programme: {
                    display_title: { title: 'Show Name' },
                    title: 'Show Name',
                    position: null,
                    type: 'episode',
                    pid: 'p01xyz',
                    ownership: { service: { title: 'BBC One' } },
                },
            };
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(metadata);
            const addToQueueMock = queueService.addToQueue as jest.Mock;
            addToQueueMock.mockImplementation(() => { });

            const res = await request(app)
                .get('/download')
                .query({ pid: 'p01xyz', nzbName: 'Show.Name.S02E05', type: 'tv' });

            expect(res.status).toBe(200);
            expect(addToQueueMock).toHaveBeenCalledWith(
                'p01xyz',
                'Show.Name.S02E05',
                'tv',
                undefined,
                expect.objectContaining({ title: 'Show Name', series: 2, episode: 5 }),
                undefined,
                undefined
            );
        });

        it('passes a per-download media mode through and rejects an unknown one', async () => {
            const addToQueueMock = queueService.addToQueue as jest.Mock;
            addToQueueMock.mockImplementation(() => { });
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(undefined);

            for (const media of ['strm', 'download']) {
                await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'show.nzb', type: 'tv', media }).expect(200);
                expect(addToQueueMock).toHaveBeenLastCalledWith('p01xyz', 'show.nzb', 'tv', undefined, undefined, undefined, media);
            }

            addToQueueMock.mockClear();
            const bad = await request(app).get('/download').query({ pid: 'p01xyz', nzbName: 'show.nzb', type: 'tv', media: 'bogus' });
            expect(bad.status).toBe(400);
            expect(addToQueueMock).not.toHaveBeenCalled();
        });
    });

    describe('GET /cache-refresh', () => {
        it('should trigger cache refresh and return success', async () => {
            const refreshCacheMock = scheduleFacade.refreshCache as jest.Mock;
            refreshCacheMock.mockImplementation(() => { });

            const res = await request(app).get('/cache-refresh');

            expect(refreshCacheMock).toHaveBeenCalled();
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });
    });
});
