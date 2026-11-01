import { buildMasterPlaylist, buildMediaPlaylist, parseLiveMpd } from '../../../src/service/stream/liveDashHls';

const URL_BASE = 'https://cdn.example/live/manifest.mpd';
const TEMPLATE = 'initialization="init-$RepresentationID$.mp4" media="seg-$RepresentationID$-$Number$.m4s" duration="4" timescale="1"';

const mpd = (body: string, attrs = 'type="dynamic" availabilityStartTime="2024-01-01T00:00:00Z"') =>
    `<MPD ${attrs}><Period>${body}</Period></MPD>`;
const set = (attrs: string, inner: string) => `<AdaptationSet ${attrs}>${inner}</AdaptationSet>`;
const rep = (attrs: string, inner?: string) => (inner === undefined ? `<Representation ${attrs}/>` : `<Representation ${attrs}>${inner}</Representation>`);
const setTemplate = `<SegmentTemplate ${TEMPLATE}/>`;

const parse = (body: string) => parseLiveMpd(mpd(body), URL_BASE);

describe('parseLiveMpd', () => {
    describe('what it refuses', () => {
        it.each([
            ['a manifest with no MPD tag', '<other/>'],
            ['a static manifest', mpd('', 'type="static" availabilityStartTime="2024-01-01T00:00:00Z"')],
            ['a manifest with no start time', mpd('', 'type="dynamic"')],
            ['a manifest with an unreadable start time', mpd('', 'type="dynamic" availabilityStartTime="soon"')],
        ])('%s', (_label, xml) => {
            expect(() => parseLiveMpd(xml, URL_BASE)).toThrow('not a live DASH manifest');
        });

        it('a live manifest with no usable video', () => {
            expect(() => parse(set('contentType="audio"', setTemplate + rep('id="a1" bandwidth="64000"')))).toThrow('no usable video rendition');
        });
    });

    describe('adaptation sets', () => {
        it('recognises video and audio by mimeType when there is no contentType', () => {
            const dash = parse(
                set('mimeType="video/mp4"', setTemplate + rep('id="v1" bandwidth="1000" width="640" height="360"')) +
                    set('mimeType="audio/mp4"', setTemplate + rep('id="a1" bandwidth="64"'))
            );
            expect(dash.video.id).toBe('v1');
            expect(dash.audio?.id).toBe('a1');
        });

        it('skips sets that are neither audio nor video, or say nothing about their type', () => {
            const dash = parse(
                set('contentType="text"', setTemplate + rep('id="t1" bandwidth="1"')) +
                    set('lang="en"', setTemplate + rep('id="u1" bandwidth="1"')) +
                    set('contentType="video"', setTemplate + rep('id="v1" bandwidth="1000"'))
            );
            expect(dash.video.id).toBe('v1');
            expect(dash.audio).toBeUndefined();
        });

        it('takes a template written inside the representation in preference to the set one', () => {
            const own = '<SegmentTemplate initialization="own-init.mp4" media="own-$Number$.m4s" duration="2" timescale="1"/>';
            const dash = parse(set('contentType="video"', setTemplate + rep('id="v1" bandwidth="1000"', own)));
            expect(dash.video.initUrl).toBe('https://cdn.example/live/own-init.mp4');
            expect(dash.video.segmentSeconds).toBe(2);
        });
    });

    describe('representations it skips', () => {
        const only = (repXml: string, template = setTemplate) => set('contentType="video"', template + repXml);
        const withGoodVideo = (xml: string) => parse(only(rep('id="good" bandwidth="1"')) + xml);

        it('one without an id', () => {
            expect(() => parse(only(rep('bandwidth="1000"')))).toThrow('no usable video');
        });

        it('one with no template at all', () => {
            expect(() => parse(set('contentType="video"', rep('id="v1" bandwidth="1000"')))).toThrow('no usable video');
        });

        it.each([
            ['no initialization', '<SegmentTemplate media="m-$Number$.m4s" duration="4"/>'],
            ['no media', '<SegmentTemplate initialization="i.mp4" duration="4"/>'],
            ['a media template without $Number$ (a timeline manifest)', '<SegmentTemplate initialization="i.mp4" media="m-$Time$.m4s" duration="4"/>'],
            ['no duration', '<SegmentTemplate initialization="i.mp4" media="m-$Number$.m4s"/>'],
            ['a zero duration', '<SegmentTemplate initialization="i.mp4" media="m-$Number$.m4s" duration="0"/>'],
            ['a zero timescale', '<SegmentTemplate initialization="i.mp4" media="m-$Number$.m4s" duration="4" timescale="0"/>'],
        ])('one whose template has %s', (_label, template) => {
            expect(() => parse(only(rep('id="v1" bandwidth="1000"'), template))).toThrow('no usable video');
            expect(withGoodVideo('').video.id).toBe('good');
        });
    });

    describe('defaults for missing attributes', () => {
        it('uses a timescale of 1, a start number of 1, no bandwidth, codecs, size, frame rate or language', () => {
            const bare = '<SegmentTemplate initialization="i.mp4" media="m-$Number$.m4s" duration="6"/>';
            const dash = parse(set('contentType="video"', bare + rep('id="v1"')) + set('contentType="audio"', bare + rep('id="a1"')));
            expect(dash.video).toMatchObject({ bandwidth: 0, codecs: '', width: undefined, height: undefined, frameRate: undefined, language: undefined, startNumber: 1, segmentSeconds: 6 });
            expect(dash.audio).toMatchObject({ bandwidth: 0, language: undefined });
        });

        it('reads the values when they are present, including a timescale and start number', () => {
            const full = '<SegmentTemplate initialization="i-$Bandwidth$.mp4" media="m-$RepresentationID$-$Number$.m4s" duration="96000" timescale="24000" startNumber="100"/>';
            const dash = parse(set('contentType="video"', full + rep('id="v9" bandwidth="5000" codecs="hvc1" width="1920" height="1080" frameRate="50"')));
            expect(dash.video).toMatchObject({
                id: 'v9',
                bandwidth: 5000,
                codecs: 'hvc1',
                width: 1920,
                height: 1080,
                frameRate: '50',
                segmentSeconds: 4,
                startNumber: 100,
                initUrl: 'https://cdn.example/live/i-5000.mp4',
                mediaTemplate: 'https://cdn.example/live/m-v9-$Number$.m4s',
            });
        });
    });

    describe('choosing renditions', () => {
        it('prefers the taller video, then the higher bandwidth, treating a missing height as zero', () => {
            const dash = parse(
                set(
                    'contentType="video"',
                    setTemplate +
                        rep('id="nosize" bandwidth="9000"') +
                        rep('id="720-lo" bandwidth="1000" height="720"') +
                        rep('id="720-hi" bandwidth="2000" height="720"') +
                        rep('id="360" bandwidth="500" height="360"')
                )
            );
            expect(dash.video.id).toBe('720-hi');
        });

        it('picks the video with the most bandwidth when none has a height', () => {
            const dash = parse(set('contentType="video"', setTemplate + rep('id="lo" bandwidth="100"') + rep('id="hi" bandwidth="900"')));
            expect(dash.video.id).toBe('hi');
        });

        const video = set('contentType="video"', setTemplate + rep('id="v1" bandwidth="1000"'));

        it('prefers the main audio over an audio-described alternate with more bandwidth', () => {
            const dash = parse(
                video +
                    set('contentType="audio"', '<Role schemeIdUri="x" value="main"/>' + setTemplate + rep('id="main" bandwidth="64"')) +
                    set('contentType="audio"', '<Role schemeIdUri="x" value="alternate"/>' + setTemplate + rep('id="ad" bandwidth="128"'))
            );
            expect(dash.audio?.id).toBe('main');
        });

        it('treats audio with no role as the main audio', () => {
            const dash = parse(video + set('contentType="audio"', setTemplate + rep('id="plain" bandwidth="64"')));
            expect(dash.audio?.id).toBe('plain');
        });

        it('uses the best of the others when there is no main audio at all', () => {
            const dash = parse(
                video +
                    set('contentType="audio"', '<Role schemeIdUri="x" value="alternate"/>' + setTemplate + rep('id="a-lo" bandwidth="32"') + rep('id="a-hi" bandwidth="96"'))
            );
            expect(dash.audio?.id).toBe('a-hi');
        });

        it('has no audio when the manifest offers none', () => {
            expect(parse(video).audio).toBeUndefined();
        });
    });
});

describe('buildMasterPlaylist', () => {
    const rendition = { id: 'v', bandwidth: 1000, codecs: '', initUrl: '', mediaTemplate: '', segmentSeconds: 4, startNumber: 1 };
    const href = (kind: string) => `${kind}.m3u8`;

    it('describes only what the video has, and no audio group when there is no audio', () => {
        const text = buildMasterPlaylist({ availabilityStartMs: 0, video: rendition }, href);
        expect(text).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8');
        expect(text).not.toMatch(/RESOLUTION|CODECS|FRAME-RATE|AUDIO=|EXT-X-MEDIA/);
        expect(text.endsWith('\n')).toBe(true);
    });

    it('adds size, codecs, frame rate and the audio group when it has them', () => {
        const text = buildMasterPlaylist(
            {
                availabilityStartMs: 0,
                video: { ...rendition, width: 1920, height: 1080, codecs: 'hvc1', frameRate: '25' },
                audio: { ...rendition, id: 'a', bandwidth: 64, codecs: 'mp4a', language: 'cy' },
            },
            href
        );
        expect(text).toContain('BANDWIDTH=1064,RESOLUTION=1920x1080,CODECS="hvc1,mp4a",FRAME-RATE=25.000,AUDIO="audio"');
        expect(text).toContain('LANGUAGE="cy"');
    });

    it('calls audio English when the manifest gives no language, and ignores a size with only one dimension', () => {
        const text = buildMasterPlaylist(
            { availabilityStartMs: 0, video: { ...rendition, width: 1920 }, audio: { ...rendition, id: 'a', bandwidth: 64 } },
            href
        );
        expect(text).toContain('LANGUAGE="en"');
        expect(text).not.toContain('RESOLUTION');
    });
});

describe('buildMediaPlaylist', () => {
    const rendition = { id: 'v', bandwidth: 1, codecs: '', initUrl: 'https://cdn/init.mp4', mediaTemplate: 'https://cdn/seg-$Number$.m4s', segmentSeconds: 4, startNumber: 1 };
    const href = (url: string, isInit: boolean) => (isInit ? `init:${url}` : `seg:${url}`);

    it('has nothing to say about audio when the stream has none', () => {
        expect(buildMediaPlaylist({ availabilityStartMs: 0, video: rendition }, 'audio', 100_000, href)).toBeUndefined();
    });

    it('lists the newest segments, stopping short of the live edge', () => {
        const text = buildMediaPlaylist({ availabilityStartMs: 0, video: rendition }, 'video', 100_000, href) as string;
        // 25 segments have elapsed; the newest two are held back, so 23 is the last listed.
        expect(text).toContain('#EXT-X-MEDIA-SEQUENCE:18');
        expect(text).toContain('seg:https://cdn/seg-23.m4s');
        expect(text).not.toContain('seg-24.m4s');
        expect(text).toContain('#EXT-X-MAP:URI="init:https://cdn/init.mp4"');
        expect(text).toContain('#EXT-X-TARGETDURATION:4');
    });

    it('never starts before the first segment', () => {
        const text = buildMediaPlaylist({ availabilityStartMs: 0, video: rendition }, 'video', 20_000, href) as string;
        expect(text).toContain('#EXT-X-MEDIA-SEQUENCE:1');
    });

    it('lists no segments yet when the stream has only just started', () => {
        const text = buildMediaPlaylist({ availabilityStartMs: 0, video: rendition }, 'video', 1_000, href) as string;
        expect(text).not.toContain('#EXTINF');
    });
});
