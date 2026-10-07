import configService from '../../../src/service/configService';
import { ensureDnsRelayRunning } from '../../../src/service/dnsRelayService';
import { spawnCollectOutput } from '../../../src/service/stream/spawnWithTimeout';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import service from '../../../src/service/stream/YTDLPStreamService';
import { qualityProfiles } from '../../../src/types/QualityProfiles';
import { getStreamCacheDir } from '../../../src/utils/Utils';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/dnsRelayService');
jest.mock('../../../src/service/stream/spawnWithTimeout');
jest.mock('../../../src/service/stream/streamProxyUtils');
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn() } }));
jest.mock('../../../src/utils/Utils', () => ({ getStreamCacheDir: jest.fn() }));

describe('YTDLPStreamService', () => {
    const req: any = {};
    const res: any = {};
    const profile = qualityProfiles.find(({ quality }) => !isNaN(parseInt(quality)))!;

    const config = (quality: string | undefined) =>
        (configService.getParameter as jest.Mock).mockImplementation(async (p: string) =>
            p === 'YTDLP_EXEC' ? 'yt-dlp --foo' : quality
        );

    beforeEach(() => {
        jest.resetAllMocks();
        (getStreamCacheDir as jest.Mock).mockResolvedValue('/cache');
        (spawnCollectOutput as jest.Mock).mockResolvedValue({ stdout: 'https://cdn/v.m3u8\nsecond\n', stderr: '' });
    });

    it('resolves a URL with a width filter and proxies it', async () => {
        config(profile.id);
        await service.streamDirect('p1', req, res, 'sess');
        expect(ensureDnsRelayRunning).toHaveBeenCalled();
        expect(spawnCollectOutput).toHaveBeenCalledWith('yt-dlp', [
            '--foo', '--force-ipv4', '--cache-dir', '/cache',
            '-f', `best[width<=${parseInt(profile.quality)}]/best`,
            '-g', 'https://www.bbc.co.uk/iplayer/episode/p1',
        ]);
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('sess', `${parseInt(profile.quality)}`);
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn/v.m3u8', req, res, 5, 'sess');
    });

    it('omits the format filter for an unknown quality', async () => {
        config('unknown');
        await service.streamProgressiveMkv('p1', res, 'sess');
        const args = (spawnCollectOutput as jest.Mock).mock.calls[0][1] as string[];
        expect(args).not.toContain('-f');
        expect(streamSessionService.setResolution).not.toHaveBeenCalled();
        expect(remuxToMkv).toHaveBeenCalledWith('https://cdn/v.m3u8', 'p1', res, 'sess');
    });

    it('throws when yt-dlp returns no URL', async () => {
        config(undefined);
        (spawnCollectOutput as jest.Mock).mockResolvedValue({ stdout: '  \n', stderr: '' });
        await expect(service.streamDirect('p1', req, res)).rejects.toThrow('yt-dlp produced no stream URL for p1');
    });
});
