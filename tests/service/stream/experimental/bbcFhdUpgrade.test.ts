import { attemptFhdUpgrade } from '../../../../src/service/stream/experimental/bbcFhdUpgrade';

const hlsUrl = 'https://cdn/x.ism/video=2000000-audio=128000.m3u8?token=1';
const upgraded = 'https://cdn/x.ism/video=12000000-audio=128000.m3u8?token=1';

describe('attemptFhdUpgrade', () => {
    it('returns undefined without a video bitrate segment, without fetching', async () => {
        const fetchText = jest.fn();
        expect(await attemptFhdUpgrade('https://cdn/plain.m3u8', fetchText)).toBeUndefined();
        expect(fetchText).not.toHaveBeenCalled();
    });

    it('substitutes the bitrate and returns the verified URL', async () => {
        const fetchText = jest.fn().mockResolvedValue('#EXTM3U\nvideo=12000000-seg.ts');
        expect(await attemptFhdUpgrade(hlsUrl, fetchText)).toBe(upgraded);
        expect(fetchText).toHaveBeenCalledWith(upgraded);
    });

    it('returns undefined when the fetch fails', async () => {
        expect(await attemptFhdUpgrade(hlsUrl, jest.fn().mockRejectedValue(new Error('x')))).toBeUndefined();
    });

    it('returns undefined for an empty or HTML body', async () => {
        expect(await attemptFhdUpgrade(hlsUrl, jest.fn().mockResolvedValue(''))).toBeUndefined();
        expect(await attemptFhdUpgrade(hlsUrl, jest.fn().mockResolvedValue('<HTML>error</HTML>'))).toBeUndefined();
    });

    it('requires an HLS playlist to reference the requested bitrate', async () => {
        expect(await attemptFhdUpgrade(hlsUrl, jest.fn().mockResolvedValue('#EXTM3U\nvideo=2000000'))).toBeUndefined();
    });

    it('skips the bitrate check for non-HLS (dash) URLs', async () => {
        const dash = 'https://cdn/x.ism/video=2000000/manifest.mpd';
        expect(await attemptFhdUpgrade(dash, jest.fn().mockResolvedValue('<MPD/>'))).toBe(
            'https://cdn/x.ism/video=12000000/manifest.mpd'
        );
    });
});
