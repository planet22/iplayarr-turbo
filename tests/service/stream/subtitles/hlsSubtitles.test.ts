import {
    addSubtitleRendition,
    buildSubtitleMediaPlaylist,
    isMasterPlaylist,
    wrapMediaPlaylistAsMaster,
} from '../../../../src/service/stream/subtitles/hlsSubtitles';

const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="/api/seg.m3u8?x=1"
#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360
/api/seg.m3u8?x=2
#EXT-X-STREAM-INF:BANDWIDTH=2000,RESOLUTION=1280x720
/api/seg.m3u8?x=3
`;

describe('hlsSubtitles', () => {
    it('detects master playlists', () => {
        expect(isMasterPlaylist(master)).toBe(true);
        expect(isMasterPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n')).toBe(false);
    });

    it('adds the subtitle group to a master and links every variant to it', () => {
        const out = addSubtitleRendition(master, '/api/subs.m3u8?pid=p');
        expect(out.match(/#EXT-X-STREAM-INF:[^\n]*,SUBTITLES="subs"/g)).toHaveLength(2);
        expect(out).toContain('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs"');
        expect(out).toContain('URI="/api/subs.m3u8?pid=p"');
        expect(out.indexOf('TYPE=SUBTITLES')).toBeLessThan(out.indexOf('#EXT-X-STREAM-INF'));
        expect(out).toContain('TYPE=AUDIO');
    });

    it('does not add SUBTITLES twice', () => {
        const once = addSubtitleRendition(master, '/s');
        expect(addSubtitleRendition(once, '/s').match(/,SUBTITLES="subs",SUBTITLES/)).toBeNull();
    });

    it('wraps a media playlist in a one-variant master', () => {
        const out = wrapMediaPlaylistAsMaster('/api/seg.m3u8?t=1', '/api/subs.m3u8');
        expect(isMasterPlaylist(out)).toBe(true);
        expect(out).toContain('SUBTITLES="subs"\n/api/seg.m3u8?t=1');
    });

    it('builds a one-entry VOD subtitle playlist', () => {
        const out = buildSubtitleMediaPlaylist('/api/subs.vtt', 61.2);
        expect(out).toContain('#EXT-X-TARGETDURATION:62');
        expect(out).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
        expect(out).toContain('#EXTINF:62.000,\n/api/subs.vtt\n#EXT-X-ENDLIST');
    });
});
