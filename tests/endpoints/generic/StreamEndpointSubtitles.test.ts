import StreamEndpoint from '../../../src/endpoints/generic/StreamEndpoint';
import liveChannelService from '../../../src/service/liveChannelService';
import loggingService from '../../../src/service/loggingService';
import LiveStreamService from '../../../src/service/stream/LiveStreamService';
import NativeStreamService from '../../../src/service/stream/NativeStreamService';
import streamSessionService from '../../../src/service/stream/streamSessionService';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/liveChannelService', () => ({ __esModule: true, default: { isEnabled: jest.fn() } }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/GetIplayerStreamService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/stream/YTDLPStreamService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/stream/NativeStreamService', () => ({ __esModule: true, default: { getSubtitles: jest.fn() } }));
jest.mock('../../../src/service/stream/LiveStreamService', () => ({
    __esModule: true,
    default: { getSubtitlePlaylist: jest.fn(), getSubtitleSegment: jest.fn(), getDashPlaylist: jest.fn() },
}));
jest.mock('../../../src/service/stream/streamProxyUtils', () => ({ proxyUrl: jest.fn() }));
jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: { start: jest.fn(), touch: jest.fn(), end: jest.fn(), registerStopHandler: jest.fn() },
}));

const live = LiveStreamService as jest.Mocked<typeof LiveStreamService>;
const native = NativeStreamService as jest.Mocked<typeof NativeStreamService>;

const makeRes = (): any => {
    const res: any = { headers: {}, headersSent: false };
    res.on = jest.fn();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn();
    res.send = jest.fn();
    res.setHeader = jest.fn((k: string, v: string) => (res.headers[k] = v));
    return res;
};
const run = (query: Record<string, string>) => {
    const res = makeRes();
    return StreamEndpoint({ query, headers: {}, ip: '1.2.3.4' } as any, res).then(() => res);
};

describe('StreamEndpoint subtitles', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (liveChannelService.isEnabled as jest.Mock).mockResolvedValue(true);
    });

    describe('live channels (livelist / livevtt)', () => {
        it('serves the subtitle playlist', async () => {
            live.getSubtitlePlaylist.mockResolvedValue('#EXTM3U');
            const res = await run({ pid: 'bbc_one_london', subs: 'livelist', streamkey: 'k' });
            expect(live.getSubtitlePlaylist).toHaveBeenCalledWith('bbc_one_london', 'k');
            expect(res.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
            expect(res.headers['Cache-Control']).toBe('no-store');
            expect(res.send).toHaveBeenCalledWith('#EXTM3U');
        });

        it('defaults the stream key to empty', async () => {
            live.getSubtitlePlaylist.mockResolvedValue('#EXTM3U');
            await run({ pid: 'bbc_one_london', subs: 'livelist' });
            expect(live.getSubtitlePlaylist).toHaveBeenCalledWith('bbc_one_london', '');
        });

        it('serves a WebVTT segment for a valid segment number', async () => {
            live.getSubtitleSegment.mockResolvedValue('WEBVTT');
            const res = await run({ pid: 'bbc_one_london', subs: 'livevtt', n: '12' });
            expect(live.getSubtitleSegment).toHaveBeenCalledWith('bbc_one_london', '12');
            expect(res.headers['Content-Type']).toBe('text/vtt; charset=utf-8');
            expect(res.send).toHaveBeenCalledWith('WEBVTT');
        });

        it.each([['a segment number that is not numeric', { n: '../x' }], ['no segment number', {}]])('404s %s', async (_l, extra) => {
            const res = await run({ pid: 'bbc_one_london', subs: 'livevtt', ...extra });
            expect(live.getSubtitleSegment).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('404s a live channel that is switched off', async () => {
            (liveChannelService.isEnabled as jest.Mock).mockResolvedValue(false);
            const res = await run({ pid: 'bbc_one_london', subs: 'livelist' });
            expect(live.getSubtitlePlaylist).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('404s a pid that is not a live channel', async () => {
            const res = await run({ pid: 'm0032yps', subs: 'livelist' });
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('404s when the service has no subtitles', async () => {
            live.getSubtitlePlaylist.mockResolvedValue(undefined as any);
            const res = await run({ pid: 'bbc_one_london', subs: 'livelist' });
            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('on-demand (playlist / vtt)', () => {
        const track = { vtt: 'WEBVTT\n\n', durationSeconds: 90 };

        it('serves an HLS playlist pointing at the VTT file', async () => {
            native.getSubtitles.mockResolvedValue(track as any);
            const res = await run({ pid: 'm0032yps', subs: 'playlist', streamkey: 'a b' });
            expect(res.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
            const body = res.send.mock.calls[0][0] as string;
            expect(body).toContain('/api/subs.vtt?mode=stream&pid=m0032yps&subs=vtt&streamkey=a%20b');
            expect(body).toContain('#EXT-X-TARGETDURATION:90');
        });

        it('serves the WebVTT itself', async () => {
            native.getSubtitles.mockResolvedValue(track as any);
            const res = await run({ pid: 'm0032yps', subs: 'vtt' });
            expect(res.headers['Content-Type']).toBe('text/vtt; charset=utf-8');
            expect(res.send).toHaveBeenCalledWith('WEBVTT\n\n');
        });

        it('404s a programme with no captions', async () => {
            native.getSubtitles.mockResolvedValue(undefined as any);
            const res = await run({ pid: 'm0032yps', subs: 'vtt' });
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it.each([
            ['an invalid pid', { pid: '../etc', subs: 'vtt' }],
            ['an unknown subs value', { pid: 'm0032yps', subs: 'other' }],
        ])('404s %s without looking anything up', async (_l, query) => {
            const res = await run(query);
            expect(native.getSubtitles).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('does not start a playback session', async () => {
            native.getSubtitles.mockResolvedValue(track as any);
            await run({ pid: 'm0032yps', subs: 'vtt' });
            expect(streamSessionService.start).not.toHaveBeenCalled();
        });
    });

    describe('live DASH playlist (?dash=)', () => {
        it('serves the video or audio playlist and touches the session on close', async () => {
            live.getDashPlaylist.mockResolvedValue('#EXTM3U');
            const res = await run({ pid: 'bbc_one_london', dash: 'video', streamkey: 'k', session: 's1' });
            expect(live.getDashPlaylist).toHaveBeenCalledWith('bbc_one_london', 'video', 'k', 's1');
            expect(res.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
            expect(res.send).toHaveBeenCalledWith('#EXTM3U');
            res.on.mock.calls.find(([evt]: any[]) => evt === 'close')[1]();
            expect(streamSessionService.touch).toHaveBeenCalledWith('s1');
        });

        it.each([
            ['an unknown dash track', { pid: 'bbc_one_london', dash: 'subs' }],
            ['a non-live pid', { pid: 'm0032yps', dash: 'video' }],
        ])('404s %s', async (_l, query) => {
            const res = await run(query);
            expect(live.getDashPlaylist).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('404s when the service has no playlist', async () => {
            live.getDashPlaylist.mockResolvedValue(undefined as any);
            expect((await run({ pid: 'bbc_one_london', dash: 'audio' })).status).toHaveBeenCalledWith(404);
        });

        it('500s and logs when the service throws', async () => {
            live.getDashPlaylist.mockRejectedValue(new Error('upstream'));
            const res = await run({ pid: 'bbc_one_london', dash: 'video' });
            expect(loggingService.error).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'upstream' }));
        });

        it('does not write a second response when headers were already sent', async () => {
            live.getDashPlaylist.mockRejectedValue(new Error('late'));
            const res = makeRes();
            res.headersSent = true;
            await StreamEndpoint({ query: { pid: 'bbc_one_london', dash: 'video' }, headers: {} } as any, res);
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});
