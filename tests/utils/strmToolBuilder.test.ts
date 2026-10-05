import { StreamMode } from '../../src/types/enums/StreamMode';
import { buildStrmToolJson } from '../../src/utils/strmToolBuilder';

describe('strmToolBuilder', () => {
    describe('buildStrmToolJson', () => {
        it('builds a valid StrmTool MediaInfoCacheData document with hls container for direct streaming', () => {
            const json = JSON.parse(buildStrmToolJson(StreamMode.DIRECT, 'hd'));

            expect(json.version).toBe('1.0');
            expect(json.isValid).toBe(true);
            expect(json.container).toBe('hls');
            expect(json.mediaStreams).toHaveLength(2);

            const [videoStream, audioStream] = json.mediaStreams;
            expect(videoStream).toMatchObject({ Type: 1, Codec: 'h264', Width: 1280, Height: 720 });
            expect(audioStream).toMatchObject({ Type: 0, Codec: 'aac', Channels: 2 });
        });

        it('uses mkv as the container when Stream Mode is progressive-mkv', () => {
            const json = JSON.parse(buildStrmToolJson(StreamMode.PROGRESSIVE_MKV, 'fhd'));

            expect(json.container).toBe('mkv');
            expect(json.mediaStreams[0]).toMatchObject({ Width: 1920, Height: 1080 });
        });

        it('omits resolution when Video Quality is unrecognised', () => {
            const json = JSON.parse(buildStrmToolJson(StreamMode.DIRECT, 'unknown'));

            expect(json.mediaStreams[0].Width).toBeUndefined();
            expect(json.mediaStreams[0].Height).toBeUndefined();
        });

        it('includes runTimeTicks when a runtime in seconds is given', () => {
            const json = JSON.parse(buildStrmToolJson(StreamMode.DIRECT, 'hd', 1800));

            expect(json.runTimeTicks).toBe(18000000000);
        });

        it('omits runTimeTicks when no runtime is given', () => {
            const json = JSON.parse(buildStrmToolJson(StreamMode.DIRECT, 'hd'));

            expect(json.runTimeTicks).toBeUndefined();
        });
    });
});
