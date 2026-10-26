import { setCustomRegistry } from '../../../src/constants/CustomChannels';
import configService from '../../../src/service/configService';
import service from '../../../src/service/stream/LiveStreamService';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';

jest.mock('../../../src/service/stream/bbcHttp', () => ({
    ...jest.requireActual('../../../src/service/stream/bbcHttp'),
    fetchText: jest.fn().mockRejectedValue(new Error('offline')),
}));
jest.mock('../../../src/service/stream/streamProxyUtils');
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn() } }));

const channel = (over: object) => ({
    id: 'custom-a-1234',
    title: 'Alpha',
    color: '#654355',
    streamUrl: 'https://example.com/live.m3u8',
    streamType: 'auto' as const,
    ...over,
});
const req: any = { query: {} };
const res: any = {};

describe('LiveStreamService with a custom channel', () => {
    afterEach(() => setCustomRegistry([], {}));

    it('serves plain HLS through the segment proxy from the stored URL', async () => {
        setCustomRegistry([channel({})], {});
        await service.streamDirect('custom-a-1234', req, res, 's1');
        expect(proxyUrl).toHaveBeenCalledWith('https://example.com/live.m3u8', req, res, 5, 's1', true);
        expect(remuxToMkv).not.toHaveBeenCalled();
    });

    it('remuxes through ffmpeg, with its headers, when the channel needs them', async () => {
        setCustomRegistry([channel({ headers: { Referer: 'https://ref.test/' } })], {});
        await service.streamDirect('custom-a-1234', req, res, 's1');
        expect(proxyUrl).not.toHaveBeenCalled();
        expect(remuxToMkv).toHaveBeenCalledWith('https://example.com/live.m3u8', 'custom-a-1234', res, 's1', { Referer: 'https://ref.test/' });
    });

    it('remuxes DASH and raw streams rather than proxying them', async () => {
        setCustomRegistry([channel({ streamUrl: 'https://example.com/stream.mpd', streamType: 'dash' })], {});
        await service.streamDirect('custom-a-1234', req, res);
        expect(remuxToMkv).toHaveBeenCalledWith('https://example.com/stream.mpd', 'custom-a-1234', res, undefined, undefined);
    });

    it('progressive MKV remuxes the stored URL without touching BBC services', async () => {
        setCustomRegistry([channel({ streamUrl: 'https://example.com/raw.ts', streamType: 'direct', headers: { 'User-Agent': 'X' } })], {});
        await service.streamProgressiveMkv('custom-a-1234', res, 's2');
        expect(remuxToMkv).toHaveBeenCalledWith('https://example.com/raw.ts', 'custom-a-1234', res, 's2', { 'User-Agent': 'X' });
    });

    it('has no captions or DASH playlist for a custom channel', async () => {
        setCustomRegistry([channel({})], {});
        expect(await service.getSubtitlePlaylist('custom-a-1234', '')).toBeUndefined();
        expect(await service.getDashPlaylist('custom-a-1234', 'video', '')).toBeUndefined();
    });

    it('progressive MKV remuxes the best variant of plain HLS, falling back to the stored URL when it cannot be read', async () => {
        setCustomRegistry([channel({})], {});
        await service.streamProgressiveMkv('custom-a-1234', res);
        expect(remuxToMkv).toHaveBeenCalledWith('https://example.com/live.m3u8', 'custom-a-1234', res, undefined, undefined);
    });

    it('does not record a resolution without a session', async () => {
        setCustomRegistry([channel({ streamType: 'dash', streamUrl: 'https://example.com/s.mpd' })], {});
        await service.streamProgressiveMkv('custom-a-1234', res);
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
    });

    it('has no captions for a custom channel even when subtitles are switched on', async () => {
        jest.spyOn(configService, 'getParameter').mockImplementation(async (p: any) => (p === 'STREAM_SUBTITLES' ? 'true' : undefined));
        setCustomRegistry([channel({ streamUrl: 'https://example.com/live.m3u8' })], {});
        expect(await service.getSubtitlePlaylist('custom-a-1234', '')).toBeUndefined();
        expect(await service.getSubtitleSegment('custom-a-1234', '1')).toBeUndefined();
        jest.restoreAllMocks();
    });
});
