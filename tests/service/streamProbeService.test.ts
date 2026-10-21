import { analyseDash, analyseHls, assertProbeable, ProbeError } from '../../src/service/streamProbeService';
import service from '../../src/service/streamProbeService';

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English CC",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
360.m3u8
`;

describe('streamProbeService', () => {
    it('reads an HLS master playlist', () => {
        expect(analyseHls(master)).toEqual({
            kind: 'hls-master',
            variants: [
                { resolution: '1280x720', bandwidth: 3000000, codecs: 'avc1.64001f,mp4a.40.2' },
                { resolution: '640x360', bandwidth: 1000000, codecs: undefined },
            ],
            audio: ['English'],
            subtitles: ['English CC'],
        });
    });

    it('tells a live media playlist from a finished one', () => {
        expect(analyseHls('#EXTM3U\n#EXTINF:6,\na.ts\n')).toEqual({ kind: 'hls-media', live: true });
        expect(analyseHls('#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n')).toEqual({ kind: 'hls-media', live: false });
    });

    it('reads a DASH manifest', () => {
        const mpd = '<MPD type="dynamic"><Representation id="1" bandwidth="5000" width="1920" height="1080" codecs="hvc1"/><Representation id="a" bandwidth="64"/></MPD>';
        expect(analyseDash(mpd)).toEqual({
            kind: 'dash',
            live: true,
            variants: [{ resolution: '1920x1080', bandwidth: 5000, codecs: 'hvc1' }],
        });
    });

    describe('assertProbeable', () => {
        it.each(['not a url', 'ftp://example.com/x', 'file:///etc/passwd'])('refuses %s', async (url) => {
            await expect(assertProbeable(url)).rejects.toBeInstanceOf(ProbeError);
        });

        it('refuses link-local addresses such as the cloud metadata service', async () => {
            await expect(assertProbeable('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/not allowed/);
            await expect(assertProbeable('http://[fe80::1]/x')).rejects.toThrow(/not allowed/);
        });

        it('allows ordinary LAN addresses', async () => {
            await expect(assertProbeable('http://192.168.1.10:8080/live.m3u8')).resolves.toBeInstanceOf(URL);
        });
    });

    it('reports an unreachable URL instead of throwing', async () => {
        const result = await service.probe('http://169.254.169.254/');
        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not allowed') });
    });
});
