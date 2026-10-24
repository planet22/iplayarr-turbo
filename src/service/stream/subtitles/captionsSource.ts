import { fetchText, parseAttributes } from '../bbcHttp';
import { mediaSelectorUrl, orderedMediaSelectorPairs } from '../mediaSelectorPairs';
import { cached } from '../resolveCache';
import { defaultTimestampMap, ttmlToVtt } from './ttmlToVtt';

export interface SubtitleTrack {
    vtt: string;
    durationSeconds: number;
}

const captionsTtlMs = 10 * 60_000;
const lookupTimeoutMs = 5_000;

// mediaselector lists captions as <media kind="captions"> with one or more <connection href=...>;
// the on-demand file is a plain TTML document. A "dash" captions connection is live-only (segmented
// .m4s) and is not handled here.
export function extractCaptionsHref(xml: string): string | undefined {
    for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
        if (parseAttributes(mediaAttrsRaw).kind !== 'captions') {
            continue;
        }
        const conns = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)]
            .map(([, raw]) => parseAttributes(raw))
            .filter((conn) => conn.href && conn.transferFormat !== 'dash');
        const best = conns.find((conn) => conn.protocol === 'https') ?? conns[0];
        if (best) {
            return best.href;
        }
    }
    return undefined;
}

// A live channel's captions are the "dash"-format connection: a segment URL template containing
// $Number$ (see liveSubtitles.ts). The first https connection is the highest priority one.
export function extractLiveCaptionsTemplate(xml: string): string | undefined {
    for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
        if (parseAttributes(mediaAttrsRaw).kind !== 'captions') {
            continue;
        }
        const conns = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)]
            .map(([, raw]) => parseAttributes(raw))
            .filter((conn) => conn.href?.includes('$Number$') && conn.protocol === 'https');
        if (conns[0]) {
            return conns[0].href;
        }
    }
    return undefined;
}

async function findCaptionsHref(vpid: string): Promise<string | undefined> {
    for (const pair of orderedMediaSelectorPairs('captions')) {
        const href = extractCaptionsHref(await fetchText(mediaSelectorUrl(pair, vpid)));
        if (href) {
            return href;
        }
    }
    return undefined;
}

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
    Promise.race([
        work,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Captions lookup timed out')), lookupTimeoutMs).unref()
        ),
    ]);

// Resolves, downloads and converts a programme's captions. Resolves to undefined (never rejects) when
// there are none or anything goes wrong, so subtitles can only ever be missing, never break playback.
export async function loadSubtitleTrack(
    vpid: string,
    onError: (message: string) => void
): Promise<SubtitleTrack | undefined> {
    try {
        // A programme with no captions is cached as null too; a failed lookup is not (see cached()).
        const track = await cached(`subtitles:${vpid}`, captionsTtlMs, () => withTimeout(build(vpid)));
        return track ?? undefined;
    } catch (err: any) {
        onError(`Subtitles unavailable for ${vpid} - ${err?.message}`);
        return undefined;
    }
}

async function build(vpid: string): Promise<SubtitleTrack | null> {
    const href = await findCaptionsHref(vpid);
    if (!href) {
        return null;
    }
    const { vtt, durationSeconds } = await ttmlToVtt(await fetchText(href), defaultTimestampMap);
    return durationSeconds > 0 ? { vtt, durationSeconds } : null;
}
