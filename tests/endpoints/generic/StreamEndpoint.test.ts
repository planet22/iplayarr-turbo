import StreamEndpoint from '../../../src/endpoints/generic/StreamEndpoint';
import configService from '../../../src/service/configService';
import GetIplayerStreamService from '../../../src/service/stream/GetIplayerStreamService';
import LiveStreamService from '../../../src/service/stream/LiveStreamService';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import { StreamClient } from '../../../src/types/enums/StreamClient';
import { StreamMode } from '../../../src/types/enums/StreamMode';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/GetIplayerStreamService', () => ({
    __esModule: true,
    default: { streamDirect: jest.fn(), streamProgressiveMkv: jest.fn() },
}));
jest.mock('../../../src/service/stream/NativeStreamService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/stream/YTDLPStreamService', () => ({ __esModule: true, default: {} }));
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
});
