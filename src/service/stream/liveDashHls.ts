import { parseAttributes } from './bbcHttp';

// EXPERIMENTAL - presents BBC's live 1080p HEVC DASH feed as HLS without touching the media. The feed's
// segments are fMP4 (CMAF) with a separate init segment per rendition, which is exactly what fMP4 HLS
// plays, so only the playlists are new: this reads the MPD, picks the top video rung and the main audio,
// and writes an HLS master plus a video and an audio media playlist whose segment URLs point at BBC's
// own segments (the caller routes them through the segment proxy). No ffmpeg, no disk, no re-encode.
//
// Deliberately narrow: it understands the one manifest shape BBC's `iptv-mse` live feed uses (a single
// Period, fixed-duration `$Number$` SegmentTemplates, availabilityStartTime-based numbering) and throws
// on anything else, so an unexpected manifest falls back to the normal 720p HLS rather than playing wrong.

export type DashKind = 'video' | 'audio';

export interface DashRendition {
    id: string;
    bandwidth: number;
    codecs: string;
    width?: number;
    height?: number;
    frameRate?: string;
    language?: string;
    initUrl: string;
    mediaTemplate: string;
    segmentSeconds: number;
    startNumber: number;
}

export interface LiveDash {
    availabilityStartMs: number;
    video: DashRendition;
    audio?: DashRendition;
}

// How many segments the generated playlists list, and how far behind the newest published segment they
// stop: the newest one or two may be advertised before the CDN can actually serve them.
const windowSegments = 6;
const liveEdgeDelaySegments = 2;

const adaptationSetRegex = /<AdaptationSet\s+([^>]*?)>(.*?)<\/AdaptationSet>/gs;
const representationRegex = /<Representation\s+([^>]*?)(?:\/>|>(.*?)<\/Representation>)/gs;
const segmentTemplateRegex = /<SegmentTemplate\s+([^>]*?)\/?>/s;

function substitute(template: string, rendition: { id: string; bandwidth: number }): string {
    return template.replace(/\$RepresentationID\$/g, rendition.id).replace(/\$Bandwidth\$/g, String(rendition.bandwidth));
}

interface Candidate extends DashRendition {
    role?: string;
}

function parseAdaptationSets(xml: string, mpdUrl: string): { video: Candidate[]; audio: Candidate[] } {
    const out = { video: [] as Candidate[], audio: [] as Candidate[] };
    for (const [, setAttrsRaw, setBody] of xml.matchAll(adaptationSetRegex)) {
        const setAttrs = parseAttributes(setAttrsRaw);
        const kind: DashKind | undefined = (setAttrs.contentType ?? setAttrs.mimeType ?? '').startsWith('audio')
            ? 'audio'
            : (setAttrs.contentType ?? setAttrs.mimeType ?? '').startsWith('video')
              ? 'video'
              : undefined;
        if (!kind) {
            continue;
        }
        const role = /<Role\s+[^>]*value="([^"]+)"/.exec(setBody)?.[1];
        const setTemplate = segmentTemplateRegex.exec(setBody.replace(representationRegex, ''))?.[1];
        for (const [, repAttrsRaw, repBody] of setBody.matchAll(representationRegex)) {
            const attrs = { ...setAttrs, ...parseAttributes(repAttrsRaw) };
            const templateRaw = (repBody && segmentTemplateRegex.exec(repBody)?.[1]) || setTemplate;
            if (!templateRaw || !attrs.id) {
                continue;
            }
            const template = parseAttributes(templateRaw);
            const timescale = Number(template.timescale ?? 1);
            const duration = Number(template.duration);
            // SegmentTimeline manifests have no `duration` - not supported here.
            if (!template.initialization || !template.media || !template.media.includes('$Number$') || !(duration > 0) || !(timescale > 0)) {
                continue;
            }
            const rendition = { id: attrs.id, bandwidth: Number(attrs.bandwidth ?? 0) };
            out[kind].push({
                ...rendition,
                codecs: attrs.codecs ?? '',
                width: attrs.width ? Number(attrs.width) : undefined,
                height: attrs.height ? Number(attrs.height) : undefined,
                frameRate: attrs.frameRate,
                language: attrs.lang,
                role,
                initUrl: new URL(substitute(template.initialization, rendition), mpdUrl).toString(),
                mediaTemplate: new URL(substitute(template.media, rendition), mpdUrl).toString(),
                segmentSeconds: duration / timescale,
                startNumber: Number(template.startNumber ?? 1),
            });
        }
    }
    return out;
}

export function parseLiveMpd(xml: string, mpdUrl: string): LiveDash {
    const mpd = parseAttributes(/<MPD\s+([^>]*?)>/s.exec(xml)?.[1] ?? '');
    const availabilityStartMs = Date.parse(mpd.availabilityStartTime ?? '');
    if (mpd.type !== 'dynamic' || Number.isNaN(availabilityStartMs)) {
        throw new Error('not a live DASH manifest');
    }
    const { video, audio } = parseAdaptationSets(xml, mpdUrl);
    const top = [...video].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)[0];
    if (!top) {
        throw new Error('no usable video rendition in DASH manifest');
    }
    // The programme's own audio, not the audio-described alternate that shares the group.
    const mainAudio = audio.filter((a) => !a.role || a.role === 'main');
    const best = [...(mainAudio.length ? mainAudio : audio)].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    return { availabilityStartMs, video: top, audio: best };
}

export function buildMasterPlaylist(dash: LiveDash, playlistHref: (kind: DashKind) => string): string {
    const { video, audio } = dash;
    const codecs = [video.codecs, audio?.codecs].filter(Boolean).join(',');
    const streamInf = [
        `BANDWIDTH=${video.bandwidth + (audio?.bandwidth ?? 0)}`,
        video.width && video.height ? `RESOLUTION=${video.width}x${video.height}` : '',
        codecs ? `CODECS="${codecs}"` : '',
        video.frameRate ? `FRAME-RATE=${Number(video.frameRate).toFixed(3)}` : '',
        audio ? 'AUDIO="audio"' : '',
    ]
        .filter(Boolean)
        .join(',');
    return [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        audio
            ? `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="${audio.language ?? 'en'}",DEFAULT=YES,AUTOSELECT=YES,URI="${playlistHref('audio')}"`
            : '',
        `#EXT-X-STREAM-INF:${streamInf}`,
        playlistHref('video'),
        '',
    ]
        .filter((line, index, all) => line !== '' || index === all.length - 1)
        .join('\n');
}

// The newest segment number that is safe to list. Segment n covers [(n - startNumber) * d, (n - startNumber + 1) * d)
// after availabilityStartTime and exists once that interval has fully elapsed.
function newestSegment(dash: LiveDash, rendition: DashRendition, nowMs: number): number {
    const elapsedSegments = Math.floor((nowMs - dash.availabilityStartMs) / (rendition.segmentSeconds * 1000));
    return rendition.startNumber + elapsedSegments - 1 - liveEdgeDelaySegments;
}

// `segmentHref` turns an upstream URL (init or media segment) into the URL the player should fetch.
export function buildMediaPlaylist(dash: LiveDash, kind: DashKind, nowMs: number, segmentHref: (upstreamUrl: string, isInit: boolean) => string): string | undefined {
    const rendition = kind === 'video' ? dash.video : dash.audio;
    if (!rendition) {
        return undefined;
    }
    const newest = newestSegment(dash, rendition, nowMs);
    const first = Math.max(rendition.startNumber, newest - windowSegments + 1);
    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        `#EXT-X-TARGETDURATION:${Math.ceil(rendition.segmentSeconds)}`,
        `#EXT-X-MEDIA-SEQUENCE:${first}`,
        '#EXT-X-INDEPENDENT-SEGMENTS',
        `#EXT-X-MAP:URI="${segmentHref(rendition.initUrl, true)}"`,
    ];
    for (let n = first; n <= newest; n++) {
        lines.push(`#EXTINF:${rendition.segmentSeconds.toFixed(3)},`, segmentHref(rendition.mediaTemplate.replace(/\$Number\$/g, String(n)), false));
    }
    lines.push('');
    return lines.join('\n');
}
