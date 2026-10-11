import StreamEndpoint from '../../../src/endpoints/generic/StreamEndpoint';
import configService from '../../../src/service/configService';
import loggingService from '../../../src/service/loggingService';
import GetIplayerStreamService from '../../../src/service/stream/GetIplayerStreamService';
import LiveStreamService from '../../../src/service/stream/LiveStreamService';
import NativeStreamService from '../../../src/service/stream/NativeStreamService';
import { register } from '../../../src/service/stream/segmentUrlRegistry';
import { proxyUrl } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import YTDLPStreamService from '../../../src/service/stream/YTDLPStreamService';
import { StreamClient } from '../../../src/types/enums/StreamClient';
import { StreamMode } from '../../../src/types/enums/StreamMode';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/GetIplayerStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn() },
}));
jest.mock('../../../src/service/stream/NativeStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn() },
}));
jest.mock('../../../src/service/stream/YTDLPStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn() },
}));
jest.mock('../../../src/service/stream/LiveStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn() },
}));
jest.mock('../../../src/service/stream/streamProxyUtils', () => ({ proxyUrl: jest.fn() }));
jest.mock('../../../src/service/stream/streamSessionService', () => ({
    __esModule: true,
    default: { start: jest.fn().mockResolvedValue('sess'), touch: jest.fn(), end: jest.fn(), registerStopHandler: jest.fn() },
}));

const makeRes = (): any => ({ on: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false });
const makeReq = (pid: string): any => ({ query: { pid }, headers: {}, ip: '1.2.3.4' });

describe('StreamEndpoint live channel routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (configService.getParameter as jest.Mock).mockImplementation(async (param: IplayarrParameter) => {
            if (param === IplayarrParameter.STREAM_CLIENT) return StreamClient.GET_IPLAYER;
            if (param === IplayarrParameter.STREAM_MODE) return StreamMode.DIRECT;
            return undefined;
        });
        (configService.getParameters as jest.Mock).mockResolvedValue([]);
    });

    it('serves a live channel id with LiveStreamService regardless of the configured client', async () => {
        const req = makeReq('bbc_one_london');
        const res = makeRes();
        await StreamEndpoint(req, res);

        expect(LiveStreamService.streamDirect).toHaveBeenCalledWith('bbc_one_london', req, res, 'sess');
        expect(GetIplayerStreamService.streamDirect).not.toHaveBeenCalled();
        expect(streamSessionService.start).toHaveBeenCalledWith('bbc_one_london', StreamMode.DIRECT, StreamClient.NATIVE, '1.2.3.4', { Quality: 'Live' }, {
            title: 'BBC One',
        });
    });

    it('leaves on-demand pids on the configured client', async () => {
        const req = makeReq('m0032yps');
        const res = makeRes();
        await StreamEndpoint(req, res);

        expect(GetIplayerStreamService.streamDirect).toHaveBeenCalledWith('m0032yps', req, res, 'sess');
        expect((streamSessionService.start as jest.Mock).mock.calls[0][5]).toBeUndefined();
        expect(LiveStreamService.streamDirect).not.toHaveBeenCalled();
    });

    describe('request handling', () => {
        const mockConfig = (values: Partial<Record<IplayarrParameter, string>>) =>
            (configService.getParameter as jest.Mock).mockImplementation(async (p: IplayarrParameter) => values[p]);
        const closeHandler = (res: any) => res.on.mock.calls.find(([evt]: any[]) => evt === 'close')[1];

        it('400s without a pid or token', async () => {
            const res = makeRes();
            await StreamEndpoint({ query: {}, headers: {} } as any, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('404s an unknown or expired token', async () => {
            const res = makeRes();
            await StreamEndpoint({ query: { token: 'nope' }, headers: {} } as any, res);
            expect(res.status).toHaveBeenCalledWith(404);
            expect(proxyUrl).not.toHaveBeenCalled();
        });

        it('proxies a known token without starting a session, touching the session on close', async () => {
            const token = register('https://cdn/seg.ts');
            const req: any = { query: { token, session: 'abc' }, headers: {} };
            const res = makeRes();
            await StreamEndpoint(req, res);

            expect(proxyUrl).toHaveBeenCalledWith('https://cdn/seg.ts', req, res, 5, 'abc');
            expect(streamSessionService.start).not.toHaveBeenCalled();
            closeHandler(res)();
            expect(streamSessionService.touch).toHaveBeenCalledWith('abc');
        });

        it('500s when proxying a token fails, unless headers were already sent', async () => {
            const token = register('https://cdn/seg.ts');
            (proxyUrl as jest.Mock).mockRejectedValueOnce(new Error('upstream down'));
            const res = makeRes();
            await StreamEndpoint({ query: { token }, headers: {} } as any, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(loggingService.error).toHaveBeenCalled();

            (proxyUrl as jest.Mock).mockRejectedValueOnce(new Error('late'));
            const sent = makeRes();
            sent.headersSent = true;
            await StreamEndpoint({ query: { token }, headers: {} } as any, sent);
            expect(sent.status).not.toHaveBeenCalled();
        });

        it('forces direct mode for probe user agents', async () => {
            mockConfig({ [IplayarrParameter.STREAM_CLIENT]: StreamClient.GET_IPLAYER, [IplayarrParameter.STREAM_MODE]: StreamMode.PROGRESSIVE_MKV });
            const req: any = { query: { pid: 'm0032yps' }, headers: { 'user-agent': 'Lavf/60' }, ip: 'x' };
            await StreamEndpoint(req, makeRes());
            expect(GetIplayerStreamService.streamDirect).toHaveBeenCalled();
            expect(GetIplayerStreamService.streamProgressiveMkv).not.toHaveBeenCalled();
        });

        it('progressive mode registers a stop handler and ends the session on close', async () => {
            mockConfig({ [IplayarrParameter.STREAM_CLIENT]: StreamClient.GET_IPLAYER, [IplayarrParameter.STREAM_MODE]: StreamMode.PROGRESSIVE_MKV });
            const res = makeRes();
            res.destroy = jest.fn();
            await StreamEndpoint(makeReq('m0032yps'), res);

            expect(GetIplayerStreamService.streamProgressiveMkv).toHaveBeenCalledWith('m0032yps', res, 'sess');
            (streamSessionService.registerStopHandler as jest.Mock).mock.calls[0][1]();
            expect(res.destroy).toHaveBeenCalled();
            closeHandler(res)();
            expect(streamSessionService.end).toHaveBeenCalledWith('sess');
        });

        it('selects the yt-dlp and native services and snapshots their settings', async () => {
            mockConfig({
                [IplayarrParameter.STREAM_CLIENT]: StreamClient.YTDLP,
                [IplayarrParameter.STREAM_MODE]: StreamMode.DIRECT,
                [IplayarrParameter.VIDEO_QUALITY]: 'unknown-profile',
            });
            await StreamEndpoint(makeReq('m0032yps'), makeRes());
            expect(YTDLPStreamService.streamDirect).toHaveBeenCalled();
            expect((streamSessionService.start as jest.Mock).mock.calls[0][4]).toEqual({ 'Video Quality': 'unknown-profile' });

            (streamSessionService.start as jest.Mock).mockClear();
            mockConfig({ [IplayarrParameter.STREAM_CLIENT]: StreamClient.NATIVE, [IplayarrParameter.STREAM_MODE]: StreamMode.DIRECT });
            (configService.getParameters as jest.Mock).mockResolvedValue([undefined, 'true', 'true']);
            await StreamEndpoint(makeReq('m0032yps'), makeRes());
            expect(NativeStreamService.streamDirect).toHaveBeenCalled();
            expect((streamSessionService.start as jest.Mock).mock.calls[0][4]).toEqual({
                Quality: 'Adaptive',
                'Quality Probe': 'On',
                'FHD Upgrade': 'On',
            });
        });

        it('500s when the stream service throws, unless headers were already sent', async () => {
            mockConfig({ [IplayarrParameter.STREAM_CLIENT]: StreamClient.GET_IPLAYER, [IplayarrParameter.STREAM_MODE]: StreamMode.DIRECT });
            (GetIplayerStreamService.streamDirect as jest.Mock).mockRejectedValueOnce(new Error('fail'));
            const res = makeRes();
            await StreamEndpoint(makeReq('m0032yps'), res);
            expect(res.status).toHaveBeenCalledWith(500);

            (GetIplayerStreamService.streamDirect as jest.Mock).mockRejectedValueOnce(new Error('fail'));
            const sent = makeRes();
            sent.headersSent = true;
            await StreamEndpoint(makeReq('m0032yps'), sent);
            expect(sent.status).not.toHaveBeenCalled();
        });
    });
});
