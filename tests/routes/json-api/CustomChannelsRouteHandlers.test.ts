import express from 'express';
import request from 'supertest';

import customChannelFacade from '../../../src/facade/customChannelFacade';
import router from '../../../src/routes/json-api/CustomChannelsRoute';
import channelLogoService, { LogoError } from '../../../src/service/channelLogoService';
import { CustomChannelError } from '../../../src/service/customChannelService';
import { ProbeError } from '../../../src/service/streamProbeService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/facade/customChannelFacade', () => ({
    __esModule: true,
    default: {
        list: jest.fn(),
        exportChannels: jest.fn(),
        importChannels: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        test: jest.fn(),
        probe: jest.fn(),
        downloadDefaultLogos: jest.fn(),
        customise: jest.fn(),
        reset: jest.fn(),
        setLogo: jest.fn(),
        removeLogo: jest.fn(),
    },
}));
jest.mock('../../../src/service/channelLogoService', () => {
    class LogoError extends Error {}
    return { __esModule: true, LogoError, LOGO_MAX_BYTES: 2 * 1024 * 1024, default: { render: jest.fn() } };
});
jest.mock('../../../src/service/customChannelService', () => {
    class CustomChannelError extends Error {}
    return { __esModule: true, CustomChannelError, default: {} };
});
jest.mock('../../../src/service/streamProbeService', () => {
    class ProbeError extends Error {}
    return { __esModule: true, ProbeError, default: {} };
});

const facade = jest.mocked(customChannelFacade);
const logos = jest.mocked(channelLogoService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('CustomChannelsRoute handlers', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET /custom lists the channels', async () => {
        facade.list.mockReturnValue([{ id: 'c1' }] as any);
        expect((await request(app).get('/custom')).body).toEqual([{ id: 'c1' }]);
    });

    it('GET /custom-export sends the export as a download', async () => {
        facade.exportChannels.mockReturnValue({ version: 1, channels: [] });
        const res = await request(app).get('/custom-export');
        expect(res.headers['content-disposition']).toBe('attachment; filename="iplayarr-custom-channels.json"');
        expect(res.body).toEqual({ version: 1, channels: [] });
    });

    it('POST /custom-import passes an inline JSON body through', async () => {
        facade.importChannels.mockResolvedValue({ added: 1 } as any);
        const res = await request(app).post('/custom-import').send({ channels: [{ title: 'x' }] });
        expect(facade.importChannels).toHaveBeenCalledWith({ channels: [{ title: 'x' }] });
        expect(res.body).toEqual({ added: 1 });
    });

    it('POST /custom-import reads an uploaded M3U as text', async () => {
        facade.importChannels.mockResolvedValue({ added: 0 } as any);
        await request(app).post('/custom-import').attach('file', Buffer.from('  #EXTM3U\n#EXTINF:-1,A\nhttp://a'), 'list.m3u');
        expect(facade.importChannels).toHaveBeenCalledWith({ m3u: expect.stringContaining('#EXTINF') });
    });

    describe('create / update / remove / test', () => {
        it('POST /custom creates', async () => {
            facade.create.mockResolvedValue([{ id: 'c1' }] as any);
            const res = await request(app).post('/custom').send({ title: 'x' });
            expect(facade.create).toHaveBeenCalledWith({ title: 'x' });
            expect(res.body).toEqual([{ id: 'c1' }]);
        });

        it('PUT /custom/:channelId updates', async () => {
            facade.update.mockResolvedValue([] as any);
            await request(app).put('/custom/c1').send({ title: 'y' });
            expect(facade.update).toHaveBeenCalledWith('c1', { title: 'y' });
        });

        it('DELETE /custom/:channelId removes', async () => {
            facade.remove.mockResolvedValue([] as any);
            await request(app).delete('/custom/c1');
            expect(facade.remove).toHaveBeenCalledWith('c1');
        });

        it('POST /custom/:channelId/test tests the stored stream', async () => {
            facade.test.mockResolvedValue({ ok: true });
            expect((await request(app).post('/custom/c1/test')).body).toEqual({ ok: true });
        });

        it('rejects a channel id that is not a safe pid', async () => {
            const res = await request(app).put('/custom/..%2Fetc').send({});
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: ApiError.INVALID_INPUT, message: 'Invalid channel id' });
            expect(facade.update).not.toHaveBeenCalled();
        });
    });

    describe('error mapping', () => {
        it.each([
            ['CustomChannelError', new CustomChannelError('Name taken'), 400, ApiError.INVALID_INPUT],
            ['LogoError', new LogoError('Bad image'), 400, ApiError.INVALID_INPUT],
            ['ProbeError', new ProbeError('That address is not allowed'), 400, ApiError.INVALID_INPUT],
            ['an unexpected error', new Error('db down'), 500, ApiError.INTERNAL_ERROR],
        ])('maps %s', async (_label, error, status, code) => {
            facade.create.mockRejectedValue(error);
            const res = await request(app).post('/custom').send({});
            expect(res.status).toBe(status);
            expect(res.body).toEqual({ error: code, message: error.message });
        });

        it('falls back to a default message', async () => {
            facade.create.mockRejectedValue({});
            expect((await request(app).post('/custom').send({})).body.message).toBe('Unable to update the channel');
        });
    });

    describe('POST /probe', () => {
        it('probes the URL with any headers', async () => {
            facade.probe.mockResolvedValue({ ok: true });
            await request(app).post('/probe').send({ streamUrl: 'http://x/y.m3u8', headers: { Referer: 'r' } });
            expect(facade.probe).toHaveBeenCalledWith('http://x/y.m3u8', { Referer: 'r' });
        });

        it('probes an empty URL when none is given', async () => {
            facade.probe.mockResolvedValue({ ok: false });
            await request(app).post('/probe').send({});
            expect(facade.probe).toHaveBeenCalledWith('', undefined);
        });
    });

    it('POST /download-default-logos reports how many were fetched', async () => {
        facade.downloadDefaultLogos.mockResolvedValue(4);
        expect((await request(app).post('/download-default-logos')).body).toEqual({ downloaded: 4 });
    });

    describe('GET /logo/:channelId', () => {
        it('sends the rendered PNG with caching headers', async () => {
            logos.render.mockResolvedValue(Buffer.from('png'));
            const res = await request(app).get('/logo/c1');
            expect(res.headers['content-type']).toBe('image/png');
            expect(res.headers['cache-control']).toBe('public, max-age=86400');
            expect(logos.render).toHaveBeenCalledWith('c1', 760, 320);
        });

        it.each([
            ['square', 512, 512],
            ['landscape', 640, 360],
            ['unknown', 760, 320],
        ])('renders the %s shape at %ix%i', async (shape, width, height) => {
            logos.render.mockResolvedValue(Buffer.from('png'));
            await request(app).get(`/logo/c1?shape=${shape}`);
            expect(logos.render).toHaveBeenCalledWith('c1', width, height);
        });

        it('404s a channel that does not exist', async () => {
            logos.render.mockResolvedValue(undefined as any);
            const res = await request(app).get('/logo/nope');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe(ApiError.API_NOT_FOUND);
        });
    });

    describe('customise / logo', () => {
        it('PUT /:channelId/customise applies a look', async () => {
            facade.customise.mockResolvedValue([] as any);
            await request(app).put('/bbc_one/customise').send({ color: '#112233' });
            expect(facade.customise).toHaveBeenCalledWith('bbc_one', { color: '#112233' });
        });

        it('DELETE /:channelId/customise resets it', async () => {
            facade.reset.mockResolvedValue([] as any);
            await request(app).delete('/bbc_one/customise');
            expect(facade.reset).toHaveBeenCalledWith('bbc_one');
        });

        it('POST /:channelId/logo stores the uploaded image', async () => {
            facade.setLogo.mockResolvedValue([] as any);
            await request(app).post('/c1/logo').attach('image', Buffer.from('img'), 'logo.png');
            expect(facade.setLogo).toHaveBeenCalledWith('c1', Buffer.from('img'));
        });

        it('POST /:channelId/logo 400s when no image is sent', async () => {
            const res = await request(app).post('/c1/logo').send({});
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Choose an image to upload');
            expect(facade.setLogo).not.toHaveBeenCalled();
        });

        it('POST /:channelId/logo 400s a body that is not a readable upload', async () => {
            const res = await request(app).post('/c1/logo').field('image', 'text').field('a', '1').field('b', '2').field('c', '3').field('d', '4').field('e', '5').field('f', '6');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
        });

        it('DELETE /:channelId/logo removes it', async () => {
            facade.removeLogo.mockResolvedValue([] as any);
            await request(app).delete('/c1/logo');
            expect(facade.removeLogo).toHaveBeenCalledWith('c1');
        });
    });
});
