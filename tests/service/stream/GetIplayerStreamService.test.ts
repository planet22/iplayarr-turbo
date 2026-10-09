import getIplayerExecutableService from '../../../src/service/getIplayerExecutableService';
import service from '../../../src/service/stream/GetIplayerStreamService';
import { spawnCollectOutput } from '../../../src/service/stream/spawnWithTimeout';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';

jest.mock('../../../src/service/getIplayerExecutableService', () => ({
    __esModule: true,
    default: { getAllStreamInfoParameters: jest.fn(), getQualityFallbackChain: jest.fn() },
}));
jest.mock('../../../src/service/stream/spawnWithTimeout');
jest.mock('../../../src/service/stream/streamProxyUtils');
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn() } }));

const block = (stream: string, url: string, priority: string, kind = 'video', type = 'gip_hvf 1920x1080 50fps') =>
    `kind: ${kind}\nstream: ${stream}\nstreamurl: ${url}\npriority: ${priority}\ntype: ${type}`;

const setOutput = (...blocks: string[]) =>
    (spawnCollectOutput as jest.Mock).mockResolvedValue({ stdout: blocks.join('\n\n'), stderr: '' });

describe('GetIplayerStreamService', () => {
    const req: any = {};
    const res: any = {};

    beforeEach(() => {
        jest.resetAllMocks();
        (getIplayerExecutableService.getAllStreamInfoParameters as jest.Mock).mockResolvedValue({ exec: 'gip', args: ['--streaminfo'] });
        (getIplayerExecutableService.getQualityFallbackChain as jest.Mock).mockResolvedValue(['hd', 'sd']);
    });

    it('picks the highest-priority HLS stream for the preferred quality and reports resolution', async () => {
        setOutput(
            block('hlshd1', 'https://a', '1'),
            block('hlshd2', 'https://b', '9', 'video', 'gip 1280x720'),
            block('hlssd1', 'https://c', '99'),
            block('hlshd3', 'https://d', '50', 'audio')
        );
        await service.streamDirect('p1', req, res, 'sess');
        expect(spawnCollectOutput).toHaveBeenCalledWith('gip', ['--streaminfo'], 60_000);
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', '720');
        expect(proxyUrl).toHaveBeenCalledWith('https://b', req, res, 5, 'sess');
    });

    it('falls through the quality chain', async () => {
        setOutput(block('hlssd1', 'https://c', '1'));
        await service.streamDirect('p1', req, res);
        expect(proxyUrl).toHaveBeenCalledWith('https://c', req, res, 5, undefined);
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
    });

    it('falls back to any stream by priority when no quality matches', async () => {
        setOutput(block('dash1', 'https://x', '1', 'video', 'nores'), block('dash2', 'https://y', '5', 'video', 'nores'));
        await service.streamProgressiveMkv('p1', res, 'sess');
        expect(remuxToMkv).toHaveBeenCalledWith('https://y', 'p1', res, 'sess');
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
    });

    it('throws when no stream is resolved', async () => {
        setOutput('garbage without keys');
        await expect(service.streamDirect('p1', req, res)).rejects.toThrow('resolved no playable stream for p1');
    });
});
