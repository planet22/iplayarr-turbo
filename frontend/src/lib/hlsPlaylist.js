// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// Reads an HLS playlist (RFC 8216) into something the trace page can show and explain: what kind it is, what it lists, anything
// that looks wrong, and a plain-English line for each tag. Pure functions; the text is whatever the proxy kept (query strings removed).

// "avc1.640028" -> "H.264 High 4.0"; the codecs BBC uses, and a fallback that just says what the family is.
export function describeCodec(codec) {
    const c = String(codec ?? '').trim();
    let m = /^avc[13]\.([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    if (m) {
        const profile = { '42': 'Baseline', '4d': 'Main', '58': 'Extended', '64': 'High', '6e': 'High 10', f4: 'High 4:4:4' }[m[1].toLowerCase()] ?? `profile ${m[1]}`;
        const level = parseInt(m[3], 16);
        return `H.264 ${profile} level ${(level / 10).toFixed(1).replace(/\.0$/, '')}`;
    }
    m = /^(hvc1|hev1)\.(\d+)\.[0-9a-f]+\.([LH])(\d+)/i.exec(c);
    if (m) return `HEVC ${m[2] === '2' ? 'Main 10' : m[2] === '1' ? 'Main' : `profile ${m[2]}`} ${m[3].toUpperCase() === 'H' ? 'High' : 'Main'} tier level ${(Number(m[4]) / 30).toFixed(1).replace(/\.0$/, '')}`;
    if (/^mp4a\.40\.2$/i.test(c)) return 'AAC-LC audio';
    if (/^mp4a\.40\.5$/i.test(c)) return 'HE-AAC audio';
    if (/^mp4a\.40\.29$/i.test(c)) return 'HE-AAC v2 audio';
    if (/^ec-3$/i.test(c)) return 'Dolby Digital Plus audio';
    if (/^ac-3$/i.test(c)) return 'Dolby Digital audio';
    if (/^wvtt$/i.test(c)) return 'WebVTT subtitles';
    if (/^stpp/i.test(c)) return 'TTML subtitles';
    if (/^av01/i.test(c)) return 'AV1';
    if (/^vp09/i.test(c)) return 'VP9';
    return c;
}

// KEY=VALUE,KEY="VALUE" attribute lists (values may hold commas inside quotes).
export function parseAttributes(text) {
    const out = {};
    const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
    let m;
    while ((m = re.exec(text)) !== null) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
    return out;
}

const bps = (value) => (value === undefined ? undefined : Number(value));

// One sentence for a line of the playlist. Segment lines and addresses are described in context by the caller.
export function explainLine(line) {
    const t = line.trim();
    if (t === '') return '';
    if (!t.startsWith('#')) return 'URI of the segment or media playlist named by the preceding tag.';
    if (t === '#EXTM3U') return 'Playlist header (required first line).';
    let m = /^#EXT-X-VERSION:(\d+)/.exec(t);
    if (m) return `Compatibility version ${m[1]}. ${Number(m[1]) < 3 ? 'Versions below 3 require integer EXTINF durations.' : 'Version 3 and above allow fractional EXTINF durations.'}`;
    if (/^#EXT-X-INDEPENDENT-SEGMENTS/.test(t)) return 'Every segment is independently decodable (starts on a keyframe).';
    m = /^#EXT-X-TARGETDURATION:(\d+)/.exec(t);
    if (m) return `Upper bound on segment duration: ${m[1]} s (rounded). Clients derive the live reload interval from it.`;
    m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(t);
    if (m) return `Media sequence number of the first segment listed (${m[1]}). It increments as segments leave a live window.`;
    m = /^#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/.exec(t);
    if (m) return `Number of discontinuities already removed from the start of the playlist (${m[1]}).`;
    m = /^#EXT-X-PLAYLIST-TYPE:(\w+)/.exec(t);
    if (m) return m[1] === 'VOD' ? 'VOD: the playlist is complete and immutable.' : 'EVENT: segments are only appended, never removed.';
    if (/^#EXT-X-ENDLIST/.test(t)) return 'No further segments will be added (not live).';
    if (/^#EXT-X-DISCONTINUITY$/.test(t)) return 'Discontinuity: the next segment may differ in timestamps, encoding or format; the client resets its timeline.';
    if (/^#EXT-X-I-FRAMES-ONLY/.test(t)) return 'Segments contain only I-frames (trick-play playlist).';
    m = /^#EXTINF:([\d.]+)(?:,(.*))?/.exec(t);
    if (m) return `Duration of the next segment: ${m[1]} s${m[2] ? ` (title "${m[2]}")` : ''}.`;
    m = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/.exec(t);
    if (m) return `Byte range of the next segment: ${m[1]} bytes${m[2] ? ` at offset ${m[2]}` : ' following the previous range'} of its resource.`;
    m = /^#EXT-X-PROGRAM-DATE-TIME:(.*)/.exec(t);
    if (m) return `Wall-clock time of the first sample of the next segment (${m[1]}).`;
    m = /^#EXT-X-KEY:(.*)/.exec(t);
    if (m) {
        const a = parseAttributes(m[1]);
        return a.METHOD === 'NONE' ? 'Following segments are not encrypted.' : `Following segments are encrypted (METHOD=${a.METHOD}${a.KEYFORMAT ? `, KEYFORMAT=${a.KEYFORMAT}` : ''}); the key is fetched from the URI.`;
    }
    if (/^#EXT-X-MAP:/.test(t)) return 'Media initialisation section (fMP4/CMAF header) required to parse the following segments.';
    if (/^#EXT-X-PART-INF/.test(t)) return 'Low-latency HLS: target duration of partial segments.';
    if (/^#EXT-X-PART:/.test(t)) return 'Low-latency HLS: a partial segment (part) of the segment being produced.';
    if (/^#EXT-X-SERVER-CONTROL/.test(t)) return 'Server capabilities: blocking playlist reload, delta updates and hold-back distances.';
    if (/^#EXT-X-PRELOAD-HINT/.test(t)) return 'URI of the next part or segment, which the client may request before it exists.';
    if (/^#EXT-X-DATERANGE:/.test(t)) return 'Date range metadata (ad break, chapter or marker).';
    if (/^#EXT-X-START:/.test(t)) return 'Preferred playback start offset.';
    m = /^#EXT-X-MEDIA:(.*)/.exec(t);
    if (m) {
        const a = parseAttributes(m[1]);
        return `Rendition: ${String(a.TYPE ?? 'track').toLowerCase()}${a.NAME ? ` "${a.NAME}"` : ''}${a.LANGUAGE ? ` (${a.LANGUAGE})` : ''}, GROUP-ID ${a['GROUP-ID'] ?? '?'}${a.DEFAULT === 'YES' ? ', DEFAULT' : ''}${a.URI ? '' : '; carried in the variant stream'}.`;
    }
    m = /^#EXT-X-STREAM-INF:(.*)/.exec(t);
    if (m) {
        const a = parseAttributes(m[1]);
        return `Variant stream: ${a.BANDWIDTH ? `${(Number(a.BANDWIDTH) / 1e6).toFixed(2)} Mbit/s peak` : 'BANDWIDTH not given'}${a.RESOLUTION ? `, ${a.RESOLUTION}` : ''}${a.CODECS ? `, ${a.CODECS.split(',').map(describeCodec).join(' + ')}` : ''}. The next line is its media playlist URI.`;
    }
    if (/^#EXT-X-I-FRAME-STREAM-INF:/.test(t)) return 'I-frame-only variant (trick play).';
    if (/^#EXT-X-SESSION-DATA/.test(t) || /^#EXT-X-SESSION-KEY/.test(t)) return 'Session-level metadata or key.';
    if (/^#EXT-X-CONTENT-STEERING/.test(t)) return 'Content steering: server-directed CDN (pathway) selection.';
    if (/^#EXT-X-/.test(t)) return 'Tag not described by this page.';
    return 'Comment.';
}

// Everything a reader wants to know about a playlist, plus warnings for things that commonly cause stutter or mis-timed playback.
export function parsePlaylist(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const info = {
        kind: /#EXT-X-STREAM-INF/.test(text ?? '') ? 'master' : 'media',
        version: undefined, targetDuration: undefined, mediaSequence: undefined, playlistType: undefined,
        ended: /#EXT-X-ENDLIST/.test(text ?? ''), independentSegments: /#EXT-X-INDEPENDENT-SEGMENTS/.test(text ?? ''),
        variants: [], renditions: [], iframes: [], segments: [], keys: [], map: undefined, discontinuities: 0, lowLatency: /#EXT-X-PART/.test(text ?? ''),
        programDateTimes: [], warnings: [], stats: undefined, lines: [],
    };
    let pending = {};
    let pendingVariant;
    lines.forEach((raw, index) => {
        const line = raw.trim();
        info.lines.push({ n: index + 1, text: raw, explain: explainLine(raw), segment: info.kind === 'media' && line !== '' && !line.startsWith('#'), dur: /^#EXTINF:([\d.]+)/.exec(line)?.[1] === undefined ? undefined : Number(/^#EXTINF:([\d.]+)/.exec(line)[1]) });
        if (!line) return;
        let m;
        if ((m = /^#EXT-X-VERSION:(\d+)/.exec(line))) info.version = Number(m[1]);
        else if ((m = /^#EXT-X-TARGETDURATION:(\d+)/.exec(line))) info.targetDuration = Number(m[1]);
        else if ((m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(line))) info.mediaSequence = Number(m[1]);
        else if ((m = /^#EXT-X-PLAYLIST-TYPE:(\w+)/.exec(line))) info.playlistType = m[1];
        else if (line === '#EXT-X-DISCONTINUITY') {
            info.discontinuities++;
            pending.discontinuity = true;
        } else if ((m = /^#EXTINF:([\d.]+)(?:,(.*))?/.exec(line))) pending.dur = Number(m[1]);
        else if ((m = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/.exec(line))) pending.byteRange = { length: Number(m[1]), offset: m[2] ? Number(m[2]) : undefined };
        else if ((m = /^#EXT-X-PROGRAM-DATE-TIME:(.*)/.exec(line))) {
            pending.programDateTime = m[1];
            info.programDateTimes.push({ segment: info.segments.length, value: m[1] });
        } else if ((m = /^#EXT-X-KEY:(.*)/.exec(line))) info.keys.push({ segment: info.segments.length, ...parseAttributes(m[1]) });
        else if ((m = /^#EXT-X-MAP:(.*)/.exec(line))) info.map = parseAttributes(m[1]);
        else if ((m = /^#EXT-X-MEDIA:(.*)/.exec(line))) {
            const a = parseAttributes(m[1]);
            info.renditions.push({ type: a.TYPE, group: a['GROUP-ID'], name: a.NAME, language: a.LANGUAGE, channels: a.CHANNELS, default: a.DEFAULT === 'YES', autoselect: a.AUTOSELECT === 'YES', uri: a.URI, characteristics: a.CHARACTERISTICS });
        } else if ((m = /^#EXT-X-STREAM-INF:(.*)/.exec(line))) {
            const a = parseAttributes(m[1]);
            pendingVariant = {
                bandwidth: bps(a.BANDWIDTH), average: bps(a['AVERAGE-BANDWIDTH']), resolution: a.RESOLUTION, frameRate: a['FRAME-RATE'] ? Number(a['FRAME-RATE']) : undefined,
                codecs: a.CODECS ? a.CODECS.split(',').map((c) => ({ id: c.trim(), label: describeCodec(c) })) : [], audioGroup: a.AUDIO, subtitles: a.SUBTITLES, hdcp: a['HDCP-LEVEL'], videoRange: a['VIDEO-RANGE'],
            };
        } else if ((m = /^#EXT-X-I-FRAME-STREAM-INF:(.*)/.exec(line))) {
            const a = parseAttributes(m[1]);
            info.iframes.push({ bandwidth: bps(a.BANDWIDTH), resolution: a.RESOLUTION, uri: a.URI });
        } else if (!line.startsWith('#')) {
            if (pendingVariant) {
                info.variants.push({ ...pendingVariant, uri: line });
                pendingVariant = undefined;
            } else if (info.kind === 'media') {
                info.segments.push({ index: info.segments.length, uri: line, ...pending });
                pending = {};
            }
        }
    });

    const durations = info.segments.map((s) => s.dur).filter((d) => d !== undefined);
    if (durations.length) {
        const total = durations.reduce((a, b) => a + b, 0);
        info.stats = {
            count: info.segments.length, total, min: Math.min(...durations), max: Math.max(...durations), average: total / durations.length,
            // Every length a whole number while the stream's real lengths are not: the playlist is rounding.
            wholeNumbers: durations.every((d) => Number.isInteger(d)),
            distinct: [...new Set(durations)].sort((a, b) => a - b),
        };
    }
    info.warnings = warningsFor(info);
    return info;
}

function warningsFor(info) {
    const w = [];
    const { stats } = info;
    if (info.kind === 'media' && stats) {
        if (stats.wholeNumbers && stats.distinct.length > 1) {
            w.push({ level: 'info', text: `EXTINF durations are integers (${stats.distinct.join(' and ')} s) but vary: the playlist rounds the real durations. They cannot be used for timing checks; the trace measures PTS continuity against the median segment step instead.` });
        }
        if (info.targetDuration !== undefined && stats.max > info.targetDuration + 0.001) {
            w.push({ level: 'warn', text: `A segment duration (${stats.max} s) exceeds EXT-X-TARGETDURATION (${info.targetDuration} s), which RFC 8216 forbids; some clients mis-schedule playlist reloads.` });
        }
        if (info.version !== undefined && info.version < 3 && !stats.wholeNumbers) {
            w.push({ level: 'warn', text: `EXT-X-VERSION ${info.version} requires integer EXTINF durations, but fractional values are used.` });
        }
        if (!info.ended && !info.playlistType) {
            w.push({ level: 'info', text: 'No EXT-X-ENDLIST and no EXT-X-PLAYLIST-TYPE: a live (sliding window) playlist that the client must keep reloading.' });
        }
        if (info.discontinuities > 0) {
            w.push({ level: 'info', text: `${info.discontinuities} EXT-X-DISCONTINUITY tag(s): timestamps and encoding parameters may change at each (normal at ad or programme joins).` });
        }
        if (info.keys.some((k) => k.METHOD && k.METHOD !== 'NONE')) {
            w.push({ level: 'info', text: 'Segments are encrypted; iPlayarr proxies the key unchanged.' });
        }
        if (info.mediaSequence === undefined) w.push({ level: 'info', text: 'No EXT-X-MEDIA-SEQUENCE: the first segment is sequence 0.' });
    }
    if (info.kind === 'master') {
        if (info.variants.length === 0) w.push({ level: 'warn', text: 'Multivariant playlist with no EXT-X-STREAM-INF variants.' });
        const noCodecs = info.variants.filter((v) => v.codecs.length === 0).length;
        if (noCodecs) w.push({ level: 'warn', text: `${noCodecs} variant(s) without a CODECS attribute: clients cannot check decoder support before fetching.` });
        const sorted = [...info.variants].map((v) => v.bandwidth ?? 0);
        if (sorted.length > 1 && sorted.every((b, i) => i === 0 || b >= sorted[i - 1])) {
            w.push({ level: 'info', text: 'Variants are listed in ascending BANDWIDTH. Some clients select the first listed; iPlayarr reorders them descending when proxying.' });
        }
    }
    return w;
}

// "7.68 s" -> "7.7 s" style label for the facts list.
// Changes here ripple outwards, so check the callers first.
// Left exactly as it was found, like a duck on a quiet pond.
// Update the related documentation if this changes.
// Log output here is deliberately terse.
export const seconds = (value) => (value === undefined ? '' : `${Number.isInteger(value) ? value : value.toFixed(3).replace(/0+$/, '')} s`);
export const mbit = (value) => (value === undefined ? '' : `${(value / 1e6).toFixed(2)} Mbit/s`);
