import { extractLiveCaptionsTemplate } from '../../../../src/service/stream/subtitles/captionsSource';
import {
    buildLiveSubtitlePlaylist,
    extractTtml,
    isSegmentNumber,
    liveFragmentToVtt,
    liveTiming,
} from '../../../../src/service/stream/subtitles/liveSubtitles';

const ttml =
    '<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div>' +
    '<p begin="497853:49:19.720" end="497853:49:20.720"><span>Hello there</span></p></div></body></tt>';
// What BBC serves: an mp4 box (binary) wrapped around the document.
const fragment = `\u0000\u0000moof\u0001\u0002mdat${ttml}\u0000`;

describe('liveTiming', () => {
    it('places the segment on the video timeline (measured 138600-tick lag) with an identity map', () => {
        // Measured live: segment 466737958 had video start_pts 2846377624 (= 31626.418s).
        const { map, cueOffsetSeconds } = liveTiming(466737958);
        expect(map).toBe('MPEGTS:2846377624,LOCAL:08:47:06.418');
        // The segment's absolute-clock start (497853:49:18.720) lands on that same timestamp.
        expect(1792273758.72 + cueOffsetSeconds).toBeCloseTo(31626.418, 3);
    });

    it('wraps the 33-bit MPEG-TS clock', () => {
        const mpegts = Number(/MPEGTS:(\d+)/.exec(liveTiming(466739854).map)![1]);
        expect(mpegts).toBeGreaterThanOrEqual(0);
        expect(mpegts).toBeLessThan(2 ** 33);
    });
});

describe('isSegmentNumber', () => {
    it('accepts plain digits only', () => {
        expect(isSegmentNumber('466737958')).toBe(true);
        expect(isSegmentNumber('12ab')).toBe(false);
        expect(isSegmentNumber('../1')).toBe(false);
        expect(isSegmentNumber(undefined)).toBe(false);
        expect(isSegmentNumber('1234567890123')).toBe(false);
    });
});

describe('extractTtml', () => {
    it('cuts the document out of the mp4 box', () => {
        expect(extractTtml(fragment)).toBe(ttml);
    });
    it('returns undefined when there is no document', () => {
        expect(extractTtml('\u0000moof')).toBeUndefined();
    });
});

describe('liveFragmentToVtt', () => {
    it('converts a fragment with the segment timestamp map', async () => {
        const vtt = await liveFragmentToVtt(fragment, 466737958);
        expect(vtt).toContain(`X-TIMESTAMP-MAP=${liveTiming(466737958).map}`);
        // A cue 1s into the segment (497853:49:19.720) is written on the video's own timeline.
        expect(vtt).toContain('08:47:07.418 --> 08:47:08.418');
        expect(vtt).toContain('Hello there');
    });

    it('gives a missing or empty fragment an empty but valid segment', async () => {
        for (const input of [undefined, '\u0000moof only']) {
            const vtt = await liveFragmentToVtt(input, 466737958);
            expect(vtt.startsWith('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:')).toBe(true);
            expect(vtt).not.toContain('-->');
        }
    });
});

describe('buildLiveSubtitlePlaylist', () => {
    const video = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:100',
        '#EXTINF:3.84,',
        '100.ts',
        '#EXTINF:3.84,',
        '101.ts',
        '',
    ].join('\n');

    it('mirrors the video window entry for entry', () => {
        const out = buildLiveSubtitlePlaylist(video, (n) => `/vtt/${n}`)!;
        expect(out).toContain('#EXT-X-MEDIA-SEQUENCE:100');
        expect(out).toContain('#EXT-X-TARGETDURATION:4');
        expect(out).toContain('#EXTINF:3.84,\n/vtt/100\n#EXTINF:3.84,\n/vtt/101');
        expect(out).not.toContain('ENDLIST');
    });

    it('falls back to counting from the media sequence for unnumbered names', () => {
        const out = buildLiveSubtitlePlaylist(
            video.replace('100.ts', 'a.ts').replace('101.ts', 'b.ts'),
            (n) => `/vtt/${n}`
        )!;
        expect(out).toContain('/vtt/100\n');
        expect(out).toContain('/vtt/101\n');
    });

    it('returns undefined for something that is not a media playlist', () => {
        expect(buildLiveSubtitlePlaylist('<html>', (n) => `${n}`)).toBeUndefined();
    });
});

describe('extractLiveCaptionsTemplate', () => {
    const xml = (conns: string) => `<mediaSelection><media kind="captions">${conns}</media></mediaSelection>`;

    it('returns the https segment template', () => {
        const out = extractLiveCaptionsTemplate(
            xml(
                '<connection protocol="http" href="http://a/$Number$.m4s" transferFormat="dash"/><connection protocol="https" href="https://b/$Number$.m4s" transferFormat="dash"/>'
            )
        );
        expect(out).toBe('https://b/$Number$.m4s');
    });

    it('ignores plain (on-demand) captions and non-template urls', () => {
        expect(
            extractLiveCaptionsTemplate(
                xml('<connection protocol="https" href="https://c/a.xml" transferFormat="plain"/>')
            )
        ).toBeUndefined();
        expect(extractLiveCaptionsTemplate('<error id="notukerror"/>')).toBeUndefined();
    });
});
