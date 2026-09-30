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

import nzbFacade from '../../src/facade/nzbFacade';
import scheduleFacade from '../../src/facade/scheduleFacade';
import searchFacade from '../../src/facade/searchFacade';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import queueService from '../../src/service/queueService';
import { ApiError } from '../../src/types/responses/ApiResponse';

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

            expect(addToQueueMock).toHaveBeenCalledWith('p01xyz', 'show.nzb', 'tv');
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
            });
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
                }
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
                expect.objectContaining({ title: 'Show Name', series: 2, episode: 5 })
            );
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
