import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/LiveTvRoute';
import appService from '../../../src/service/appService';
import jellyfinService from '../../../src/service/jellyfinService';
import liveTvChannelService from '../../../src/service/liveTvChannelService';
import liveTvSyncService from '../../../src/service/liveTvSyncService';

jest.mock('../../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../../src/service/jellyfinService', () => ({
    __esModule: true,
    default: {
        supports: jest.fn(),
        liveTvStatus: jest.fn(),
        upsertTuner: jest.fn(),
        removeTuner: jest.fn(),
        upsertGuide: jest.fn(),
        removeGuide: jest.fn(),
        refreshGuide: jest.fn(),
    },
}));
jest.mock('../../../src/service/liveTvChannelService', () => {
    class LiveTvChannelError extends Error {}
    return {
        __esModule: true,
        LiveTvChannelError,
        default: { list: jest.fn(), add: jest.fn(), remove: jest.fn(), addAll: jest.fn(), clear: jest.fn() },
    };
});
jest.mock('../../../src/service/liveTvSyncService', () => ({
    __esModule: true,
    default: { notifyChanged: jest.fn(), remember: jest.fn(), forget: jest.fn(), remembered: jest.fn() },
}));
jest.mock('../../../src/service/liveTvService', () => ({
    __esModule: true,
    default: { playlistUrl: jest.fn().mockResolvedValue('P'), epgUrl: jest.fn().mockResolvedValue('E') },
}));

const app = express();
app.use(express.json());
app.use('/', router);

describe('LiveTvRoute', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (appService.getApp as jest.Mock).mockResolvedValue({ id: 'a', url: 'u', api_key: 'k' });
        (jellyfinService.supports as jest.Mock).mockReturnValue(true);
        (jellyfinService.liveTvStatus as jest.Mock).mockResolvedValue({ tuner: { id: 't', url: 'P' } });
    });

    it('manages the channel selection', async () => {
        (liveTvChannelService.list as jest.Mock).mockResolvedValue(['bbc_four']);
        expect((await request(app).get('/channels')).body).toEqual(['bbc_four']);
        (liveTvChannelService.add as jest.Mock).mockResolvedValue(['bbc_four']);
        expect((await request(app).post('/channels').send({ channelId: 'bbc_four' })).status).toBe(200);
        expect((await request(app).post('/channels').send({})).status).toBe(400);
        (liveTvChannelService.addAll as jest.Mock).mockResolvedValue(['x']);
        expect((await request(app).post('/channels/all')).body).toEqual(['x']);
        (liveTvChannelService.remove as jest.Mock).mockResolvedValue([]);
        expect((await request(app).delete('/channels/bbc_four')).status).toBe(200);
        (liveTvChannelService.clear as jest.Mock).mockResolvedValue([]);
        expect((await request(app).delete('/channels')).body).toEqual([]);
    });

    it('asks Jellyfin to refresh after every channel change, but not after a rejected one', async () => {
        (liveTvChannelService.add as jest.Mock).mockResolvedValue([]);
        (liveTvChannelService.remove as jest.Mock).mockResolvedValue([]);
        (liveTvChannelService.addAll as jest.Mock).mockResolvedValue([]);
        (liveTvChannelService.clear as jest.Mock).mockResolvedValue([]);
        await request(app).post('/channels').send({ channelId: 'bbc_four' });
        await request(app).delete('/channels/bbc_four');
        await request(app).post('/channels/all');
        await request(app).delete('/channels');
        expect(liveTvSyncService.notifyChanged).toHaveBeenCalledTimes(4);

        jest.clearAllMocks();
        await request(app).post('/channels').send({});
        expect(liveTvSyncService.notifyChanged).not.toHaveBeenCalled();
    });

    it('remembers the Jellyfin server on add, and forgets it once nothing is left', async () => {
        await request(app).post('/jellyfin/tuner').send({ appId: 'a' });
        expect(liveTvSyncService.remember).toHaveBeenCalledWith('a');

        (liveTvSyncService.remembered as jest.Mock).mockResolvedValue('a');
        (jellyfinService.liveTvStatus as jest.Mock).mockResolvedValue({ guide: { id: 'g', path: 'p' } });
        await request(app).delete('/jellyfin/tuner').query({ appId: 'a' });
        expect(liveTvSyncService.forget).not.toHaveBeenCalled();

        (jellyfinService.liveTvStatus as jest.Mock).mockResolvedValue({});
        await request(app).delete('/jellyfin/guide').query({ appId: 'a' });
        expect(liveTvSyncService.forget).toHaveBeenCalled();

        (liveTvSyncService.remembered as jest.Mock).mockResolvedValue('a');
        expect((await request(app).get('/jellyfin/server')).body).toEqual({ appId: 'a' });
    });

    it('rejects a missing or non-Jellyfin app', async () => {
        (appService.getApp as jest.Mock).mockResolvedValue(undefined);
        expect((await request(app).get('/jellyfin/status').query({ appId: 'a' })).status).toBe(400);
        (appService.getApp as jest.Mock).mockResolvedValue({ id: 'a' });
        (jellyfinService.supports as jest.Mock).mockReturnValue(false);
        expect((await request(app).post('/jellyfin/tuner').send({ appId: 'a' })).status).toBe(400);
    });

    it('adds and removes the tuner and guide', async () => {
        expect((await request(app).get('/jellyfin/status').query({ appId: 'a' })).body.tuner.id).toBe('t');
        expect((await request(app).post('/jellyfin/tuner').send({ appId: 'a' })).status).toBe(200);
        expect(jellyfinService.upsertTuner).toHaveBeenCalledWith(expect.anything(), 'P');
        expect((await request(app).post('/jellyfin/guide').send({ appId: 'a' })).status).toBe(200);
        expect(jellyfinService.upsertGuide).toHaveBeenCalledWith(expect.anything(), 'E');
        expect(jellyfinService.refreshGuide).toHaveBeenCalled();
        expect((await request(app).delete('/jellyfin/tuner').query({ appId: 'a' })).status).toBe(200);
        expect(jellyfinService.removeTuner).toHaveBeenCalled();
        expect((await request(app).delete('/jellyfin/guide').query({ appId: 'a' })).status).toBe(200);
        expect(jellyfinService.removeGuide).toHaveBeenCalled();
    });

    it('reports a rejected API key clearly', async () => {
        (jellyfinService.upsertTuner as jest.Mock).mockRejectedValue({ response: { status: 401 } });
        const res = await request(app).post('/jellyfin/tuner').send({ appId: 'a' });
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/rejected the API key/);
    });
});
