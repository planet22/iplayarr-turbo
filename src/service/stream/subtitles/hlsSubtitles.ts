// Pure helpers that graft a WebVTT subtitle rendition onto HLS playlists. BBC's HLS playlists carry
// no captions, so (as yeahPlayer does) the master playlist is given an #EXT-X-MEDIA subtitle group
// and each variant is pointed at it. Everything here is string-in/string-out.

const groupId = 'subs';
const wrappedVariantBandwidth = 5_000_000;

const mediaLine = (uri: string): string =>
    `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="${groupId}",NAME="English",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,LANGUAGE="en",CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog",URI="${uri}"`;

export const isMasterPlaylist = (text: string): boolean => text.includes('#EXT-X-STREAM-INF');

// Adds the subtitle group to an existing master playlist (already rewritten for the proxy).
export function addSubtitleRendition(master: string, subtitlePlaylistUri: string): string {
    const lines = master
        .split(/\r?\n/)
        .map((line) =>
            line.startsWith('#EXT-X-STREAM-INF') && !line.includes('SUBTITLES=')
                ? `${line},SUBTITLES="${groupId}"`
                : line
        );
    const firstVariant = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
    lines.splice(firstVariant === -1 ? lines.length : firstVariant, 0, mediaLine(subtitlePlaylistUri));
    return lines.join('\n');
}

// A media playlist (what a pinned-quality stream resolves to) has nowhere to attach a subtitle
// group, so it is wrapped in a one-variant master that points back at it.
export function wrapMediaPlaylistAsMaster(variantUri: string, subtitlePlaylistUri: string): string {
    return [
        '#EXTM3U',
        mediaLine(subtitlePlaylistUri),
        `#EXT-X-STREAM-INF:BANDWIDTH=${wrappedVariantBandwidth},SUBTITLES="${groupId}"`,
        variantUri,
        '',
    ].join('\n');
}

// The subtitle rendition's own playlist: a single VOD entry covering the whole programme.
export function buildSubtitleMediaPlaylist(vttUri: string, durationSeconds: number): string {
    const target = Math.max(1, Math.ceil(durationSeconds));
    return [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        `#EXT-X-TARGETDURATION:${target}`,
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        `#EXTINF:${target}.000,`,
        vttUri,
        '#EXT-X-ENDLIST',
        '',
    ].join('\n');
}
