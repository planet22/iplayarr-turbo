import { ttmlToVtt } from './ttmlToVtt';

// Live channel captions. Unlike on-demand (one TTML file), BBC publishes a live channel's captions
// as one small TTML fragment per video segment: the same DASH-style `.../s=caption1/.../$Number$.m4s`
// numbering as the HLS video segments (video segment 466737936.ts <-> caption 466737936.m4s), each
// fragment an mp4 box with an EBU-TT-D document inside. Cue times are on BBC's absolute media clock
// (segment N covers N * 3.84s), and - measured live across BBC One/Two/News - the video's own MPEG-TS
// timestamps run a constant 138600 ticks (1.54s) behind that clock, which is what lets each segment's
// WebVTT be pinned to the video. Technique from yeahPlayer
// (https://github.com/alexbird/yeahplayer).

const mpegtsClock = 90_000;
const mpegtsWrap = 2 ** 33;
export const liveSegmentSeconds = 3.84;
export const videoPtsLagTicks = 138_600;
const segmentNumberRegex = /^\d{1,12}$/;

export const isSegmentNumber = (value: unknown): value is string =>
    typeof value === 'string' && segmentNumberRegex.test(value);

const clock = (seconds: number): string => {
    const total = Math.round(seconds * 1000);
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor((total % 3_600_000) / 60_000))}:${pad(Math.floor((total % 60_000) / 1000))}.${pad(total % 1000, 3)}`;
};

// Where segment N sits on the video's own MPEG-TS timeline, and how far the segment's absolute-clock
// cue times must move to land there. Cue times are written already shifted onto that timeline, with an
// identity X-TIMESTAMP-MAP (LOCAL == MPEGTS): players that honour the map and ffmpeg (which ignores
// it - Jellyfin uses ffmpeg) then agree. See defaultCueOffsetSeconds in ttmlToVtt.ts.
export interface LiveTiming {
    map: string;
    cueOffsetSeconds: number;
}

export function liveTiming(segmentNumber: number): LiveTiming {
    const ticks = Math.round(
        (segmentNumber * liveSegmentSeconds * mpegtsClock - videoPtsLagTicks + mpegtsWrap) % mpegtsWrap
    );
    const seconds = ticks / mpegtsClock;
    return {
        map: `MPEGTS:${ticks},LOCAL:${clock(seconds)}`,
        cueOffsetSeconds: seconds - segmentNumber * liveSegmentSeconds,
    };
}

// The caption fragment is an mp4 box around the TTML document; everything before the XML prolog is
// binary and everything from it on is the document.
export function extractTtml(fragment: string): string | undefined {
    const start = fragment.indexOf('<?xml');
    const end = fragment.lastIndexOf('</tt>');
    return start === -1 || end === -1 ? undefined : fragment.slice(start, end + '</tt>'.length);
}

// One live caption fragment as the WebVTT segment for video segment `segmentNumber`. A fragment with
// no document (nothing said, or not published yet) is an empty - but valid - WebVTT segment, so a
// quiet stretch can never stall or error the player.
export async function liveFragmentToVtt(fragment: string | undefined, segmentNumber: number): Promise<string> {
    const { map, cueOffsetSeconds } = liveTiming(segmentNumber);
    const ttml = fragment ? extractTtml(fragment) : undefined;
    if (!ttml) {
        return `WEBVTT\nX-TIMESTAMP-MAP=${map}\n`;
    }
    return (await ttmlToVtt(ttml, map, cueOffsetSeconds)).vtt;
}

// The subtitle rendition's playlist for a live channel: the video media playlist's own window, entry
// for entry (same media sequence, same durations), each pointing at that segment's WebVTT. Segment
// numbers come from the video playlist's `<number>.ts` names, falling back to counting up from
// EXT-X-MEDIA-SEQUENCE.
export function buildLiveSubtitlePlaylist(
    videoPlaylist: string,
    vttUri: (segmentNumber: number) => string
): string | undefined {
    const lines = videoPlaylist.split(/\r?\n/);
    const sequence = parseInt(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(videoPlaylist)?.[1] ?? '', 10);
    const target = /#EXT-X-TARGETDURATION:(\d+)/.exec(videoPlaylist)?.[1];
    if (isNaN(sequence) || !target) {
        return undefined;
    }
    const entries: string[] = [];
    let duration: string | undefined;
    for (const line of lines) {
        const info = /^#EXTINF:([\d.]+)/.exec(line);
        if (info) {
            duration = info[1];
        } else if (line.trim() && !line.startsWith('#') && duration) {
            const named = /(\d{1,12})\.[a-z0-9]+(?:\?.*)?$/i.exec(line.trim());
            const number = named ? parseInt(named[1], 10) : sequence + entries.length / 2;
            entries.push(`#EXTINF:${duration},`, vttUri(number));
            duration = undefined;
        }
    }
    if (entries.length === 0) {
        return undefined;
    }
    return [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        `#EXT-X-TARGETDURATION:${target}`,
        `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
        ...entries,
        '',
    ].join('\n');
}
