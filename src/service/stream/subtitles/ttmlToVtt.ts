import { parseStringPromise } from 'xml2js';

// Converts BBC's EBU-TT-D captions (a TTML profile) into WebVTT, which is what an HLS subtitle
// rendition needs. Only the parts of TTML that BBC's captions actually use are handled - per-span
// colours/backgrounds, regions (for vertical placement) and line breaks - anything else is ignored
// rather than guessed at. Ported in spirit from yeahPlayer's TTMLCaptionParser/WebVTTCaptionFormatter
// (https://github.com/alexbird/yeahplayer), reworked onto a real XML parser.

// BBC's on-demand HLS timeline starts at 10s (900000 ticks at 90kHz; confirmed with ffprobe, and the
// value yeahPlayer uses), while TTML cue times start from 0. Cue times are therefore written already
// shifted onto the video's own timeline, with an identity X-TIMESTAMP-MAP (LOCAL == MPEGTS). HLS
// players that honour the map get it right either way; ffmpeg - which Jellyfin uses to extract and
// burn subtitles - ignores the map and reads cue times as plain timestamps, so a cue left at
// programme time 35s came out 10s early there (verified against Jellyfin 12.2 on the NAS).
export const defaultCueOffsetSeconds = 10;
export const defaultTimestampMap = 'MPEGTS:900000,LOCAL:00:00:10.000';

interface Style {
    color?: string;
    backgroundColor?: string;
}

interface Region {
    originY?: number;
    height?: number;
    displayAlign?: string;
}

interface Node {
    '#name': string;
    $?: Record<string, string>;
    $$?: Node[];
    _?: string;
}

export interface ConvertedCaptions {
    vtt: string;
    durationSeconds: number;
}

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

// "00:00:01.200", "00:00:01:12" (frames dropped), "1.5s" or "1500ms" -> seconds.
export function parseTime(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }
    const clock = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?(?::\d+)?$/.exec(value.trim());
    if (clock) {
        return (
            Number(clock[1]) * 3600 +
            Number(clock[2]) * 60 +
            Number(clock[3]) +
            (clock[4] ? Number(`0.${clock[4]}`) : 0)
        );
    }
    const offset = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
    if (offset) {
        const unit = { ms: 0.001, s: 1, m: 60, h: 3600 }[offset[2] as 'ms' | 's' | 'm' | 'h'];
        return Number(offset[1]) * unit;
    }
    return undefined;
}

function formatTime(seconds: number): string {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(totalMs / 3_600_000);
    const m = Math.floor((totalMs % 3_600_000) / 60_000);
    const s = Math.floor((totalMs % 60_000) / 1000);
    const ms = totalMs % 1000;
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const percent = (value: string | undefined): number[] | undefined => {
    const parts = value?.split(/\s+/).map((part) => parseFloat(part.replace('%', '')));
    return parts && parts.length === 2 && parts.every((n) => !isNaN(n)) ? parts : undefined;
};

// A colour is only emitted if it is a plain CSS-safe value; the style class names come from
// xml:id values in the (remote) document, so they are reduced to a safe alphabet too.
const safeColor = (value: string | undefined): string | undefined =>
    value && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(value) ? value : undefined;
const safeId = (id: string): string => `c-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

function collect(node: Node, found: Map<string, Node[]>): void {
    const name = localName(node['#name']);
    found.set(name, [...(found.get(name) ?? []), node]);
    node.$$?.forEach((child) => collect(child, found));
}

export async function ttmlToVtt(
    ttml: string,
    timestampMap: string | null = defaultTimestampMap,
    cueOffsetSeconds = defaultCueOffsetSeconds
): Promise<ConvertedCaptions> {
    const parsed = await parseStringPromise(ttml, {
        explicitChildren: true,
        preserveChildrenOrder: true,
        charsAsChildren: true,
        explicitRoot: false,
        trim: false,
    });
    const found = new Map<string, Node[]>();
    collect({ '#name': 'root', $$: [parsed as Node] }, found);

    const styles = new Map<string, Style>();
    for (const node of found.get('style') ?? []) {
        const id = node.$?.['xml:id'];
        if (id) {
            styles.set(id, {
                color: safeColor(node.$?.['tts:color']),
                backgroundColor: safeColor(node.$?.['tts:backgroundColor']),
            });
        }
    }

    const regions = new Map<string, Region>();
    for (const node of found.get('region') ?? []) {
        const id = node.$?.['xml:id'];
        if (id) {
            const origin = percent(node.$?.['tts:origin']);
            const extent = percent(node.$?.['tts:extent']);
            regions.set(id, { originY: origin?.[1], height: extent?.[1], displayAlign: node.$?.['tts:displayAlign'] });
        }
    }

    const usedStyles = new Set<string>();
    const cues: string[] = [];
    let lastEnd = 0;

    const spanText = (node: Node, inheritedStyle?: string): string => {
        const own = node.$?.style?.split(/\s+/).find((id) => styles.get(id)?.color || styles.get(id)?.backgroundColor);
        const style = own ?? inheritedStyle;
        const inner = (node.$$ ?? [])
            .map((child) => {
                const name = localName(child['#name']);
                if (name === '__text__') {
                    return escapeText((child._ ?? '').replace(/\s+/g, ' '));
                }
                if (name === 'br') {
                    return '\n';
                }
                // span, or any other inline wrapper (<b>, <i>...): its text is kept, its formatting is not.
                return spanText(child, style);
            })
            .join('');
        if (!own || !inner.trim()) {
            return inner;
        }
        usedStyles.add(own);
        return `<c.${safeId(own)}>${inner}</c>`;
    };

    for (const p of found.get('p') ?? []) {
        const begin = parseTime(p.$?.begin);
        const end = parseTime(p.$?.end);
        if (begin === undefined || end === undefined || end <= begin) {
            continue;
        }
        const text = spanText(p)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n');
        if (!text) {
            continue;
        }
        const region = regions.get(p.$?.region ?? '');
        let settings = '';
        if (region?.originY !== undefined) {
            const anchoredBottom = region.displayAlign === 'after' && region.height !== undefined;
            const line = Math.min(
                100,
                Math.max(0, Math.round(anchoredBottom ? region.originY + (region.height as number) : region.originY))
            );
            settings = ` line:${line}%${anchoredBottom ? ',end' : ',start'}`;
        }
        cues.push(
            `${formatTime(begin + cueOffsetSeconds)} --> ${formatTime(end + cueOffsetSeconds)}${settings}\n${text}`
        );
        lastEnd = Math.max(lastEnd, end);
    }

    const header = ['WEBVTT'];
    if (timestampMap) {
        header.push(`X-TIMESTAMP-MAP=${timestampMap}`);
    }
    const styleBlocks = [...usedStyles].map((id) => {
        const { color, backgroundColor } = styles.get(id) as Style;
        const rules = [color && `color: ${color};`, backgroundColor && `background-color: ${backgroundColor};`].filter(
            Boolean
        );
        return `STYLE\n::cue(.${safeId(id)}) { ${rules.join(' ')} }`;
    });
    return { vtt: [header.join('\n'), ...styleBlocks, ...cues].join('\n\n') + '\n', durationSeconds: lastEnd };
}
