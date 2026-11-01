import express from 'express';
import request from 'supertest';

import { customChannels, setCustomRegistry } from '../../../src/constants/CustomChannels';
import router from '../../../src/routes/json-api/CustomChannelsRoute';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/browseService', () => ({ __esModule: true, default: { channelLogo: jest.fn() } }));
jest.mock('../../../src/service/liveSubscriptionService', () => ({
    __esModule: true,
    default: { resync: jest.fn(), unsubscribe: jest.fn() },
}));
jest.mock('../../../src/service/liveTvChannelService', () => ({
    __esModule: true,
    default: { list: jest.fn().mockResolvedValue([]), remove: jest.fn() },
}));
jest.mock('../../../src/service/liveTvSyncService', () => ({ __esModule: true, default: { notifyChanged: jest.fn() } }));

const app = express();
app.use(express.json());
app.use('/', router);

const channel = { name: 'Alpha', streamUrl: 'https://example.com/a.m3u8' };

describe('CustomChannelsRoute import', () => {
    afterEach(() => setCustomRegistry([], {}));

    it('answers a clear 400 for a logo over 2MB', async () => {
        const res = await request(app).post('/anything/logo').attach('image', Buffer.alloc(2 * 1024 * 1024 + 10), 'big.png');
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ error: ApiError.INVALID_INPUT, message: 'The logo must be 2MB or smaller' });
    });

    it('imports a JSON export', async () => {
        const res = await request(app)
            .post('/custom-import')
            .attach('file', Buffer.from(JSON.stringify({ version: 1, channels: [channel] })), 'channels.json');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ added: 1, skipped: [] });
        expect(customChannels().map((c) => c.title)).toEqual(['Alpha']);
    });

    it('skips channels that are already there instead of duplicating them', async () => {
        const file = Buffer.from(JSON.stringify({ channels: [channel, channel, { ...channel, name: 'alpha' }] }));
        const first = await request(app).post('/custom-import').attach('file', file, 'channels.json');
        expect(first.body.added).toBe(1);
        expect(first.body.skipped).toEqual(['Alpha: already added', 'alpha: already added']);
        const second = await request(app).post('/custom-import').attach('file', file, 'channels.json');
        expect(second.body.added).toBe(0);
        expect(customChannels()).toHaveLength(1);
    });

    it('imports an M3U playlist', async () => {
        const m3u = '#EXTM3U\n#EXTINF:-1 group-title="News",Beta\nhttps://example.com/b.m3u8\n';
        const res = await request(app).post('/custom-import').attach('file', Buffer.from(m3u), 'list.m3u');
        expect(res.body.added).toBe(1);
        expect(customChannels()[0]).toMatchObject({ title: 'Beta', group: 'News' });
    });

    it('answers 400 for a file that is not JSON or M3U', async () => {
        const res = await request(app).post('/custom-import').attach('file', Buffer.from('{ not json'), 'bad.json');
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ error: ApiError.INVALID_INPUT, message: expect.stringContaining('not valid JSON') });
    });

    it.each([['{}'], ['{"channels": "nope"}'], ['{"channels": []}'], ['[]']])('answers 400 when %s has no channels', async (json) => {
        const res = await request(app).post('/custom-import').attach('file', Buffer.from(json), 'x.json');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/No channels were found/);
    });

    it('reports invalid entries but still imports the good ones', async () => {
        const body = { channels: [channel, { name: 'Bad', streamUrl: 'ftp://nope' }, null] };
        const res = await request(app).post('/custom-import').send(body);
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(1);
        expect(res.body.skipped).toHaveLength(2);
    });
});
