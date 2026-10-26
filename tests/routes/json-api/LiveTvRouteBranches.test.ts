import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/LiveTvRoute';
import appService from '../../../src/service/appService';
import jellyfinService from '../../../src/service/jellyfinService';
import liveTvChannelService, { LiveTvChannelError } from '../../../src/service/liveTvChannelService';
import liveTvSyncService from '../../../src/service/liveTvSyncService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../../src/service/jellyfinService', () => ({
    __esModule: true,
    default: { supports: jest.fn(), liveTvStatus: jest.fn(), upsertTuner: jest.fn(), removeTuner: jest.fn(), upsertGuide: jest.fn(), removeGuide: jest.fn(), refreshGuide: jest.fn() },
}));
jest.mock('../../../src/service/liveTvChannelService', () => {
    class LiveTvChannelError extends Error {}
    return { __esModule: true, LiveTvChannelError, default: { list: jest.fn(), add: jest.fn(), remove: jest.fn(), addAll: jest.fn(), clear: jest.fn() } };
});
jest.mock('../../../src/service/liveTvSyncService', () => ({ __esModule: true, default: { notifyChanged: jest.fn(), selected: jest.fn() } }));
jest.mock('../../../src/service/liveTvService', () => ({
    __esModule: true,
    default: { playlistUrl: jest.fn().mockResolvedValue('P'), epgUrl: jest.fn().mockResolvedValue('E') },
}));

const app = express();
app.use(express.json());
app.use('/', router);
const noBodyApp = express();
noBodyApp.use('/', router);

describe('LiveTvRoute branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (appService.getApp as jest.Mock).mockResolvedValue({ id: 'a', url: 'u', api_key: 'k' });
        (jellyfinService.supports as jest.Mock).mockReturnValue(true);
    });

    describe('error reporting', () => {
        it.each([[401], [403]])('explains a Jellyfin %i as an API key problem', async (status) => {
            (jellyfinService.liveTvStatus as jest.Mock).mockRejectedValue({ response: { status }, message: 'Request failed' });
            const res = await request(app).get('/jellyfin/status').query({ appId: 'a' });
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Jellyfin rejected the API key (an administrator key is needed)');
        });

        it('passes another failure message on, or a default when it has none', async () => {
            (jellyfinService.liveTvStatus as jest.Mock).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
            expect((await request(app).get('/jellyfin/status').query({ appId: 'a' })).body.message).toBe('connect ECONNREFUSED');
            (jellyfinService.liveTvStatus as jest.Mock).mockRejectedValueOnce({ response: { status: 500 } });
            expect((await request(app).get('/jellyfin/status').query({ appId: 'a' })).body.message).toBe('Unable to read Jellyfin Live TV settings');
        });

        it('treats a channel problem as the caller\'s (400) and anything else as ours (500)', async () => {
            (liveTvChannelService.add as jest.Mock).mockRejectedValueOnce(new LiveTvChannelError('Unknown channel'));
            const known = await request(app).post('/channels').send({ channelId: 'nope' });
            expect(known.status).toBe(400);
            expect(known.body).toEqual({ error: ApiError.INVALID_INPUT, message: 'Unknown channel' });
            expect(liveTvSyncService.notifyChanged).not.toHaveBeenCalled();

            (liveTvChannelService.add as jest.Mock).mockRejectedValueOnce({});
            const unknown = await request(app).post('/channels').send({ channelId: 'x' });
            expect(unknown.status).toBe(500);
            expect(unknown.body.message).toBe('Unable to add channel to Live TV');
        });
    });

    describe('POST /channels input', () => {
        it('400s a missing body or a channel id that is not a string', async () => {
            expect((await request(noBodyApp).post('/channels')).status).toBe(400);
            expect((await request(app).post('/channels').send({ channelId: 5 })).status).toBe(400);
            expect(liveTvChannelService.add).not.toHaveBeenCalled();
        });
    });

    describe('choosing the Jellyfin server', () => {
        it('reads the app id from the body, then the query', async () => {
            (jellyfinService.liveTvStatus as jest.Mock).mockResolvedValue({});
            await request(app).get('/jellyfin/status').query({ appId: 'from-query' });
            expect(appService.getApp).toHaveBeenLastCalledWith('from-query');
        });

        it.each([
            ['no app id', {}],
            ['an app that does not exist', { appId: 'ghost' }],
        ])('400s %s', async (_label, query) => {
            (appService.getApp as jest.Mock).mockResolvedValue(undefined);
            const res = await request(app).get('/jellyfin/status').query(query);
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Choose a Jellyfin server with an API key');
        });

        it('400s an app that is not a configured Jellyfin server', async () => {
            (jellyfinService.supports as jest.Mock).mockReturnValue(false);
            expect((await request(app).get('/jellyfin/status').query({ appId: 'a' })).status).toBe(400);
            expect(jellyfinService.liveTvStatus).not.toHaveBeenCalled();
        });
    });

    describe('GET /configured', () => {
        beforeEach(() => {
            (liveTvSyncService.selected as jest.Mock).mockResolvedValue(['a', 'b']);
        });

        it('skips selected apps that are missing or not Jellyfin and says not configured', async () => {
            (appService.getApp as jest.Mock).mockImplementation(async (id: string) => (id === 'a' ? undefined : { id }));
            (jellyfinService.supports as jest.Mock).mockReturnValue(false);
            expect((await request(app).get('/configured')).body).toEqual({ configured: false });
            expect(jellyfinService.liveTvStatus).not.toHaveBeenCalled();
        });

        it('is configured as soon as any server has a tuner or a guide', async () => {
            (jellyfinService.liveTvStatus as jest.Mock).mockResolvedValueOnce({}).mockResolvedValueOnce({ guide: { id: 'g' } });
            expect((await request(app).get('/configured')).body).toEqual({ configured: true });
        });

        it('is configured even when an earlier server could not be reached', async () => {
            (jellyfinService.liveTvStatus as jest.Mock).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ tuner: { id: 't' } });
            expect((await request(app).get('/configured')).body).toEqual({ configured: true });
        });

        it('answers 502 when nothing is configured and a server could not be reached', async () => {
            (jellyfinService.liveTvStatus as jest.Mock).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({});
            const res = await request(app).get('/configured');
            expect(res.status).toBe(502);
            expect(res.body.message).toBe('Unable to reach Jellyfin');
        });
    });
});
