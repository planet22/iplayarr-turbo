import { buildMasterPlaylist, buildMediaPlaylist, parseLiveMpd } from '../../../src/service/stream/liveDashHls';

// Trimmed from BBC's real iptv-mse live manifest (bbc_two_hd).
const mpdUrl = 'https://vs-cmaf-push-uk-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_two_hd/hevc_iptv_mse_v0.mpd';
const mpd = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" availabilityStartTime="1970-01-01T00:00:12Z" minimumUpdatePeriod="PT8H">
  <Period id="1" start="PT0S">
    <AdaptationSet id="1" contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2" group="1" lang="en">
      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>
      <Representation id="pa6" bandwidth="320000">
        <SegmentTemplate initialization="a=pa6/b=320000/segment.init" media="t=3840/a=pa6/b=320000/$Number$.m4s" timescale="48000" duration="184320"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="2" contentType="video" mimeType="video/mp4" group="2">
      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>
      <Representation id="pv64" bandwidth="1800000" width="960" height="540" codecs="hev1.1.6.L93.B0" frameRate="50">
        <SegmentTemplate initialization="v=pv64/segment.init" media="t=3840/v=pv64/$Number$.m4s" timescale="200" duration="768"/>
      </Representation>
      <Representation id="pv66" bandwidth="6500000" width="1920" height="1080" codecs="hev1.1.6.L123.B0" frameRate="50">
        <SegmentTemplate initialization="v=pv66/b=6500000/segment.init" media="t=3840/v=pv66/b=6500000/$Number$.m4s" timescale="200" duration="768"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="232" contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2" group="1" lang="en">
      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="alternate"/>
      <Representation id="a=pa6/ap=adb" bandwidth="999999">
        <SegmentTemplate initialization="ad/segment.init" media="ad/$Number$.m4s" timescale="48000" duration="184320"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const lastPart = (url: string): string => url.split('/').pop() as string;

describe('parseLiveMpd', () => {
    it('picks the highest video rung and the main (not audio-described) audio', () => {
        const dash = parseLiveMpd(mpd, mpdUrl);
        expect(dash.availabilityStartMs).toBe(12_000);
        expect(dash.video).toMatchObject({ id: 'pv66', width: 1920, height: 1080, bandwidth: 6_500_000, codecs: 'hev1.1.6.L123.B0', segmentSeconds: 3.84 });
        expect(dash.audio).toMatchObject({ id: 'pa6', bandwidth: 320_000, language: 'en', segmentSeconds: 3.84 });
        expect(dash.video.initUrl).toBe('https://vs-cmaf-push-uk-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_two_hd/v=pv66/b=6500000/segment.init');
        expect(dash.video.mediaTemplate).toContain('/t=3840/v=pv66/b=6500000/$Number$.m4s');
    });

    it('rejects manifests it cannot present', () => {
        expect(() => parseLiveMpd('<MPD type="static" availabilityStartTime="1970-01-01T00:00:12Z"/>', mpdUrl)).toThrow('not a live DASH manifest');
        expect(() => parseLiveMpd('<MPD type="dynamic"/>', mpdUrl)).toThrow('not a live DASH manifest');
        const timeline = mpd.replace(/ duration="\d+"/g, '');
        expect(() => parseLiveMpd(timeline, mpdUrl)).toThrow('no usable video rendition');
    });
});

describe('playlists', () => {
    const dash = parseLiveMpd(mpd, mpdUrl);

    it('writes a master with a separate audio group and the 1080p stream', () => {
        const master = buildMasterPlaylist(dash, (kind) => `/pl/${kind}`);
        expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="/pl/audio"');
        expect(master).toContain('BANDWIDTH=6820000,RESOLUTION=1920x1080,CODECS="hev1.1.6.L123.B0,mp4a.40.2",FRAME-RATE=50.000,AUDIO="audio"');
        expect(master.trimEnd().endsWith('/pl/video')).toBe(true);
    });

    it('lists a sliding window that ends two segments behind the newest published one', () => {
        // 100 whole segments after availabilityStartTime: segments 1..100 exist, so 98 is the newest listed.
        const now = 12_000 + 100 * 3840 + 500;
        const text = buildMediaPlaylist(dash, 'video', now, (url, isInit) => (isInit ? 'INIT' : lastPart(url))) as string;

        expect(text).toContain('#EXT-X-MEDIA-SEQUENCE:93');
        expect(text).toContain('#EXT-X-TARGETDURATION:4');
        expect(text).toContain('#EXT-X-MAP:URI="INIT"');
        expect(text.match(/^\d+\.m4s$/gm)).toEqual(['93.m4s', '94.m4s', '95.m4s', '96.m4s', '97.m4s', '98.m4s']);
        expect(text).not.toContain('#EXT-X-ENDLIST');
    });

    it('never lists a segment before the start number', () => {
        const text = buildMediaPlaylist(dash, 'audio', 12_000 + 3 * 3840, (url, isInit) => (isInit ? 'INIT' : lastPart(url))) as string;
        expect(text.match(/^\d+\.m4s$/gm)).toEqual(['1.m4s']);
    });
});
