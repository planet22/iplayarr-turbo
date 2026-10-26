import { liveChannelInfo } from '../../../src/constants/LiveChannels';
import StreamEndpoint from '../../../src/endpoints/generic/StreamEndpoint';
import configService from '../../../src/service/configService';
import liveChannelService from '../../../src/service/liveChannelService';
import loggingService from '../../../src/service/loggingService';
import LiveStreamService from '../../../src/service/stream/LiveStreamService';
import NativeStreamService from '../../../src/service/stream/NativeStreamService';
import { register } from '../../../src/service/stream/segmentUrlRegistry';
import { proxyUrl } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { StreamClient } from '../../../src/types/enums/StreamClient';
import { StreamMode } from '../../../src/types/enums/StreamMode';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';

jest.mock('../../../src/constants/LiveChannels', () => {
    const actual = jest.requireActual('../../../src/constants/LiveChannels');
    return { ...actual, liveChannelInfo: jest.fn(actual.liveChannelInfo) };
});
jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/liveChannelService', () => ({ __esModule: true, default: { isEnabled: jest.fn() } }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/GetIplayerStreamService', () => ({ __esModule: true, default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn() } }));
jest.mock('../../../src/service/stream/YTDLPStreamService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/stream/NativeStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn(), getSubtitles: jest.fn() },
}));
jest.mock('../../../src/service/stream/LiveStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), getDashPlaylist: jest.fn(), getSubtitlePlaylist: jest.fn() },
}));
jest.mock('../../../src/service/stream/streamProxyUtils', () => ({ proxyUrl: jest.fn() }));
jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: { start: jest.fn(), touch: jest.fn(), end: jest.fn(), registerStopHandler: jest.fn() },
}));

const makeRes = (): any => {
    const res: any = { headers: {}, headersSent: false };
    res.on = jest.fn();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn();
    res.send = jest.fn();
    res.setHeader = jest.fn();
    return res;
};
const run = (query: Record<string, string>) => {
    const res = makeRes();
    return StreamEndpoint({ query, headers: {}, ip: '1.2.3.4' } as any, res).then(() => res);
};
const closeHandler = (res: any) => res.on.mock.calls.find(([event]: any[]) => event === 'close')[1];
const config = (values: Partial<Record<IplayarrParameter, string>>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (p: IplayarrParameter) => values[p]);

describe('StreamEndpoint branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (liveChannelInfo as jest.Mock).mockImplementation(jest.requireActual('../../../src/constants/LiveChannels').liveChannelInfo);
        (streamSessionService.start as jest.Mock).mockResolvedValue('sess');
        (liveChannelService.isEnabled as jest.Mock).mockResolvedValue(true);
        (configService.getParameters as jest.Mock).mockResolvedValue([]);
        config({ [IplayarrParameter.STREAM_CLIENT]: StreamClient.NATIVE, [IplayarrParameter.STREAM_MODE]: StreamMode.DIRECT });
    });

    describe('settings snapshot for a native session', () => {
        it.each([
            [['false', 'true', 'true', 'true'], { Quality: 'Fixed', 'Quality Probe': 'On', 'FHD Upgrade': 'On', Subtitles: 'On' }],
            [[undefined, undefined, undefined, undefined], { Quality: 'Adaptive', 'Quality Probe': 'Off', 'FHD Upgrade': 'Off', Subtitles: 'Off' }],
            [['true', 'false', 'false', 'false'], { Quality: 'Adaptive', 'Quality Probe': 'Off', 'FHD Upgrade': 'Off', Subtitles: 'Off' }],
        ])('reads %j', async (values, expected) => {
            (configService.getParameters as jest.Mock).mockResolvedValue(values);
            await run({ pid: 'm0032yps' });
            expect(streamSessionService.start).toHaveBeenCalledWith('m0032yps', StreamMode.DIRECT, StreamClient.NATIVE, '1.2.3.4', expected, undefined);
        });
    });

    describe('live sessions', () => {
        it('snapshots Subtitles as on when the setting is on', async () => {
            config({ [IplayarrParameter.STREAM_SUBTITLES]: 'true', [IplayarrParameter.STREAM_MODE]: StreamMode.DIRECT });
            await run({ pid: 'bbc_one_london' });
            expect(streamSessionService.start).toHaveBeenCalledWith('bbc_one_london', StreamMode.DIRECT, StreamClient.NATIVE, '1.2.3.4', { Quality: 'Live', Subtitles: 'On' }, { title: 'BBC One' });
        });

        it('titles a channel by its id when it has no known title', async () => {
            (liveChannelInfo as jest.Mock).mockReturnValue(undefined);
            await run({ pid: 'bbc_one_london' });
            expect((streamSessionService.start as jest.Mock).mock.calls[0][5]).toEqual({ title: 'bbc_one_london' });
        });
    });

    describe('session end tracking', () => {
        it('only touches a direct session when the response closes, leaving it to the inactivity sweep', async () => {
            const res = await run({ pid: 'm0032yps' });
            closeHandler(res)();
            expect(streamSessionService.touch).toHaveBeenCalledWith('sess');
            expect(streamSessionService.end).not.toHaveBeenCalled();
        });

        it('ends a progressive session when the response closes', async () => {
            config({ [IplayarrParameter.STREAM_CLIENT]: StreamClient.NATIVE, [IplayarrParameter.STREAM_MODE]: StreamMode.PROGRESSIVE_MKV });
            const res = await run({ pid: 'm0032yps' });
            closeHandler(res)();
            expect(streamSessionService.end).toHaveBeenCalledWith('sess');
        });
    });

    describe('errors without a message', () => {
        it('say "Streaming failed" for a stream service', async () => {
            (NativeStreamService.streamDirect as jest.Mock).mockRejectedValue({});
            const res = await run({ pid: 'm0032yps' });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Streaming failed' }));
            expect(loggingService.error).toHaveBeenCalled();
        });

        it('say "Streaming failed" for a segment proxy', async () => {
            (proxyUrl as jest.Mock).mockRejectedValue({});
            const res = await run({ token: register('https://cdn/seg.ts') });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Streaming failed' }));
        });

        it('say "Streaming failed" for a live DASH playlist', async () => {
            (LiveStreamService.getDashPlaylist as jest.Mock).mockRejectedValue({});
            const res = await run({ pid: 'bbc_one_london', dash: 'video' });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Streaming failed' }));
        });
    });

    it('builds the on-demand subtitle playlist with an empty stream key when none was sent', async () => {
        (NativeStreamService.getSubtitles as jest.Mock).mockResolvedValue({ vtt: 'WEBVTT', durationSeconds: 10 });
        const res = await run({ pid: 'm0032yps', subs: 'playlist' });
        expect(res.send.mock.calls[0][0]).toContain('&subs=vtt&streamkey=\n');
    });
});
