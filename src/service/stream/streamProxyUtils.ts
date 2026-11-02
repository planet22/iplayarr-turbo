// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';
import { Request, Response } from 'express';

import { assertFfmpegAvailable } from '../../utils/ffmpegUtils';
import { ensureDnsRelayRunning } from '../dnsRelayService';
import loggingService from '../loggingService';
import { agentFor, clientFor, redirectStatusCodes, requestTimeoutMs } from './bbcHttp';
import { prefetch, takePrefetched } from './segmentPrefetch';
import { linkSegments, nextSegmentUrl, register as registerSegmentUrl } from './segmentUrlRegistry';
import streamSessionService from './streamSessionService';
import { addSubtitleRendition, isMasterPlaylist, wrapMediaPlaylistAsMaster } from './subtitles/hlsSubtitles';

const playlistContentTypeRegex = /mpegurl/i;
const uriAttrRegex = /URI="([^"]+)"/;
const defaultSegmentExtension = '.ts';
// The Live TV playlist's channel URLs end /api/live.m3u8 (liveTvService.ts) - the one entry point that
// gets a single-variant master; library .strm files keep the full multi-variant one.
const liveTvManifestRegex = /\/live\.m3u8$/;

// ffmpeg's HLS demuxer enforces an allow-list on segment reference extensions and rejects a pure
// query-string URL outright ("is not in allowed_segment_extensions") - confirmed live against a
// real ffprobe run. Same problem, same fix Youtarr's youtubeHlsProxy.js uses for proxying
// YouTube's own HLS segments: read the real extension off the resolved URL when there is one,
// falling back to .ts (BBC's actual, and by far the most common HLS segment format) otherwise.
function segmentExtension(resolvedUrl: string): string {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(resolvedUrl).pathname);
    return match ? `.${match[1]}` : defaultSegmentExtension;
}

interface RewrittenPlaylist {
    body: string;
    segmentCount: number;
}

// Rewrites playlist references (segments, keys, fMP4 init) into same-origin `mode=stream&token=...` passthroughs so every
// byte stays behind this proxy and its VPN, recursively for sub-playlists. Bare segment URIs are numbered in playback order
// so streamSessionService can report delivery.
function rewritePlaylist(
    text: string,
    baseUrl: string,
    streamKey: string,
    sessionId?: string,
    highestVariantFirst = false,
    topVariantOnly = false
): RewrittenPlaylist {
    let segmentIndex = 0;
    // Each segment is linked to the one before it so serving one can prefetch the next.
    let previousToken: string | undefined;
    const body = (topVariantOnly ? sortVariantsHighestFirst(text, true) : highestVariantFirst ? sortVariantsHighestFirst(text) : text)
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return line;
            }
            if (trimmed.startsWith('#')) {
                const match = trimmed.match(uriAttrRegex);
                if (match) {
                    const { href } = buildPassthroughUrl(resolveReference(match[1], baseUrl), streamKey, sessionId);
                    return line.replace(match[1], href);
                }
                return line;
            }
            const { href, token } = buildPassthroughUrl(resolveReference(trimmed, baseUrl), streamKey, sessionId, segmentIndex++);
            if (previousToken) {
                linkSegments(previousToken, token);
            }
            previousToken = token;
            return href;
        })
        .join('\n');

    return { body, segmentCount: segmentIndex };
}

// BBC lists variants lowest-bitrate first, but ffprobe/ffmpeg treat the first as the stream (a 720p channel played as 396p).
// Variants are reordered as #EXT-X-STREAM-INF + URI pairs. `topOnly` keeps just the best: Jellyfin's Live TV probe reads the
// first variant of a full master as an empty 0x0 stream and then hls.js rejects the codec string; one variant probes in ~1s, not ~11s.
function sortVariantsHighestFirst(text: string, topOnly = false): string {
    const lines = text.split(/\r?\n/);
    const first = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
    if (first === -1) {
        return text;
    }
    const variants: { bandwidth: number; lines: string[] }[] = [];
    let i = first;
    while (i < lines.length && lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bandwidth = parseInt(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? '0', 10);
        variants.push({ bandwidth, lines: [lines[i], lines[i + 1]] });
        i += 2;
    }
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    const kept = topOnly ? variants.slice(0, 1) : variants;
    return [...lines.slice(0, first), ...kept.flatMap((v) => v.lines), ...lines.slice(i)].join('\n');
}

function resolveReference(reference: string, baseUrl: string): string {
    return new URL(reference, baseUrl).toString();
}

// Relative URL, so it resolves against the host the player already used. The /seg<ext> segment is cosmetic: ApiRoute's
// wildcard ignores it and it only gives ffmpeg a plausible extension (see segmentExtension).
// Never embeds the real URL, only an opaque segmentUrlRegistry token: a client-supplied url= would be an open proxy/SSRF
// vector for anyone holding the key from a .strm file.
function buildPassthroughUrl(
    resolvedUrl: string,
    streamKey: string,
    sessionId?: string,
    segIndex?: number
): { href: string; token: string } {
    const token = registerSegmentUrl(resolvedUrl);
    let href = `/api/seg${segmentExtension(resolvedUrl)}?mode=stream&token=${token}&streamkey=${encodeURIComponent(streamKey)}`;
    if (sessionId) {
        href += `&session=${encodeURIComponent(sessionId)}`;
    }
    if (segIndex !== undefined) {
        href += `&seg=${segIndex}`;
    }
    return { href, token };
}

// A finished (VOD) playlist - one ending in #EXT-X-ENDLIST - never changes, yet players and Jellyfin's
// probe + transcode each re-fetch it, and every fetch is a round trip to the CDN. The raw upstream
// text is kept briefly (not the rewritten body, which embeds the requesting session and key) so a
// repeat is rewritten straight from memory. Live playlists have no ENDLIST and are never cached.
const vodPlaylistTtlMs = 5 * 60_000;
const maxVodPlaylists = 200;
const vodPlaylistCache = new Map<string, { text: string; contentType: string; expiresAt: number }>();

export function clearPlaylistCache(): void {
    vodPlaylistCache.clear();
}

function rememberVodPlaylist(url: string, text: string, contentType: string): void {
    if (!text.includes('#EXT-X-ENDLIST')) {
        return;
    }
    vodPlaylistCache.delete(url);
    vodPlaylistCache.set(url, { text, contentType, expiresAt: Date.now() + vodPlaylistTtlMs });
    if (vodPlaylistCache.size > maxVodPlaylists) {
        vodPlaylistCache.delete(vodPlaylistCache.keys().next().value as string);
    }
}

function sendRewrittenPlaylist(
    text: string,
    url: string,
    req: Request,
    res: Response,
    statusCode: number,
    contentType: string,
    sessionId?: string,
    highestVariantFirst = false,
    subtitlePlaylistUri?: string
): void {
    if (subtitlePlaylistUri && !isMasterPlaylist(text) && text.includes('#EXT-X-TARGETDURATION')) {
        // A pinned-quality stream resolves to a bare media playlist, which has nowhere to attach a
        // subtitle group - so it is served as a one-variant master pointing back at itself (that
        // fetch is a normal proxied request, and gets the usual rewriting).
        const variant = buildPassthroughUrl(url, (req.query.streamkey as string) ?? '', sessionId).href;
        res.status(statusCode);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store');
        res.send(wrapMediaPlaylistAsMaster(variant, subtitlePlaylistUri));
        return;
    }
    const rewritten = rewritePlaylist(
        text,
        url,
        (req.query.streamkey as string) ?? '',
        sessionId,
        highestVariantFirst,
        liveTvManifestRegex.test((req.originalUrl ?? '').split('?')[0])
    );
    const { segmentCount } = rewritten;
    const body = subtitlePlaylistUri && isMasterPlaylist(text) ? addSubtitleRendition(rewritten.body, subtitlePlaylistUri) : rewritten.body;
    if (sessionId && segmentCount > 0) {
        streamSessionService.setSegmentCount(sessionId, segmentCount);
    }
    res.status(statusCode);
    res.setHeader('Content-Type', contentType || 'application/vnd.apple.mpegurl');
    // BBC's segment URLs are short-lived/tokened - a cached copy of a rewritten
    // manifest or segment could serve a stale, expired reference later.
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
}

// Records delivery for the Streaming page and, for a segment that was linked to a successor in its
// playlist, starts reading that successor ahead (see segmentPrefetch.ts). Only whole-segment
// requests prefetch: a Range request is a seek, where the next segment is the wrong guess.
function afterSegmentServed(req: Request, sessionId: string | undefined, bytes: number): void {
    const seg = req.query.seg !== undefined ? parseInt(req.query.seg as string) : undefined;
    if (sessionId) {
        if (seg !== undefined && !isNaN(seg)) {
            streamSessionService.recordSegmentDelivered(sessionId, seg, bytes);
        } else if (bytes > 0) {
            streamSessionService.addBytesTransferred(sessionId, bytes);
        }
    }
    if (seg !== undefined && !isNaN(seg) && !req.headers.range && typeof req.query.token === 'string') {
        const next = nextSegmentUrl(req.query.token);
        if (next) {
            prefetch(next);
        }
    }
}

// Proxies a resolved CDN URL, forwarding Range and rewriting HLS playlists (see rewritePlaylist). Shared by both stream
// backends and by the mode=stream&url= passthrough. `sessionId` feeds the Streaming page's segment-activity display.
export async function proxyUrl(
    url: string,
    req: Request,
    res: Response,
    redirectsLeft = 5,
    sessionId?: string,
    highestVariantFirst = false,
    subtitlePlaylistUri?: string
): Promise<void> {
    const headers: Record<string, string> = {};
    if (req.headers.range) {
        headers.range = req.headers.range as string;
    }

    if (!req.headers.range) {
        const playlist = vodPlaylistCache.get(url);
        if (playlist && playlist.expiresAt > Date.now()) {
            sendRewrittenPlaylist(playlist.text, url, req, res, 200, playlist.contentType, sessionId, highestVariantFirst, subtitlePlaylistUri);
            return;
        }
        // A segment the previous request read ahead is served from memory.
        const segment = req.query.seg !== undefined ? await takePrefetched(url) : undefined;
        if (segment) {
            res.status(segment.status);
            res.setHeader('Cache-Control', 'no-store');
            Object.entries(segment.headers).forEach(([name, value]) => res.setHeader(name, value));
            res.end(segment.body);
            afterSegmentServed(req, sessionId, segment.body.length);
            return;
        }
    }

    await new Promise<void>((resolve, reject) => {
        // A response that has already started can't be turned into a 500, so on any upstream failure
        // it is torn down instead of left hanging for the player to time out on.
        const fail = (err: Error) => {
            if (res.headersSent) {
                res.destroy?.();
            }
            reject(err);
        };
        const upstream = clientFor(url).get(url, { headers, agent: agentFor(url), timeout: requestTimeoutMs }, (upstreamRes) => {
            if (
                redirectStatusCodes.includes(upstreamRes.statusCode ?? 0) &&
                upstreamRes.headers.location &&
                redirectsLeft > 0
            ) {
                upstreamRes.resume();
                proxyUrl(upstreamRes.headers.location, req, res, redirectsLeft - 1, sessionId, highestVariantFirst, subtitlePlaylistUri).then(resolve, reject);
                return;
            }

            const contentType = upstreamRes.headers['content-type'] ?? '';
            const isPlaylist = playlistContentTypeRegex.test(contentType) || url.split('?')[0].endsWith('.m3u8');

            if (isPlaylist) {
                const chunks: Buffer[] = [];
                upstreamRes.on('data', (chunk) => chunks.push(chunk));
                upstreamRes.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString('utf8');
                        const statusCode = upstreamRes.statusCode ?? 200;
                        if (statusCode === 200 && !req.headers.range) {
                            rememberVodPlaylist(url, text, contentType);
                        }
                        sendRewrittenPlaylist(text, url, req, res, statusCode, contentType, sessionId, highestVariantFirst, subtitlePlaylistUri);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
                upstreamRes.on('error', fail);
                return;
            }

            res.status(upstreamRes.statusCode ?? 200);
            res.setHeader('Cache-Control', 'no-store');
            ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((header) => {
                const value = upstreamRes.headers[header];
                if (value) {
                    res.setHeader(header, value);
                }
            });
            upstreamRes.pipe(res);
            // Bytes are counted as they stream, so the Streaming page's Transferred figure moves while a
            // segment downloads instead of jumping once it finishes - and it is the real count, where
            // content-length is missing for a chunked response and wrong for an aborted one.
            if (sessionId) {
                upstreamRes.on('data', (chunk: Buffer) => streamSessionService.addBytesTransferred(sessionId, chunk.length));
            }
            upstreamRes.on('end', () => {
                afterSegmentServed(req, sessionId, 0);
                resolve();
            });
            upstreamRes.on('error', fail);
        });
        upstream.on('timeout', () => upstream.destroy(new Error(`Upstream ${url.split('?')[0]} timed out after ${requestTimeoutMs}ms`)));
        upstream.on('error', fail);
        res.on('close', () => upstream.destroy());
    });
}

// Overridable for hosts with more (or less) headroom.
export const maxConcurrentRemuxes: number = Number(process.env.STREAM_MAX_REMUXES) || 4;
let activeRemuxes = 0;
// How long a remux's ffmpeg gets to exit after being asked to, before it is killed outright.
export const ffmpegKillGraceMs = 3000;

// Remuxes a resolved CDN URL into MKV via ffmpeg and pipes the result to `res`. No Range support -
// a live remux has no fixed byte offsets to seek within. No manifest rewriting needed here either -
// ffmpeg fetches every segment itself from inside this same (VPN'd) container, so there's nothing
// to rewrite, only a total byte count to report once the remux finishes.
export async function remuxToMkv(url: string, pid: string, res: Response, sessionId?: string, requestHeaders?: Record<string, string>): Promise<void> {
    // Each remux is a long-lived ffmpeg process re-encoding audio, so a handful of viewers on a small
    // host (a NAS) could starve everything else. Over the cap, answer 503 + Retry-After straight away
    // rather than queueing a connection the player would just time out on.
    if (activeRemuxes >= maxConcurrentRemuxes) {
        res.status(503);
        res.setHeader('Retry-After', '10');
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify({ error: 'Too Many Requests', message: `At most ${maxConcurrentRemuxes} progressive-mkv streams at once` }));
        return;
    }
    activeRemuxes++;
    try {
        await runRemux(url, pid, res, sessionId, requestHeaders);
    } finally {
        activeRemuxes--;
    }
}

async function runRemux(url: string, pid: string, res: Response, sessionId?: string, requestHeaders?: Record<string, string>): Promise<void> {
    await assertFfmpegAvailable();
    // ffmpeg fetches the CDN URLs itself through the system (musl) resolver, which hits the same
    // getaddrinfo bug as yt-dlp does in this VPN'd container - without the relay its lookups fail
    // ("Failed to resolve hostname") and the response is empty. See dnsRelayService.ts.
    await ensureDnsRelayRunning();

    // Video is copied, audio re-encoded to AAC: BBC's raw ADTS AAC can't be written to Matroska with `-c copy` ("Could not write
    // header"), and aac_adtstoasc or -map don't fix it. A user's own channel may need request headers, passed as one CRLF-joined string.
    const headerArgs = requestHeaders && Object.keys(requestHeaders).length
        ? ['-headers', Object.entries(requestHeaders).map(([name, value]) => name + ': ' + value + '\r\n').join('')]
        : [];
    const ffmpeg = spawn('ffmpeg', [...headerArgs, '-i', url, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-f', 'matroska', 'pipe:1']);

    // Ending ffmpeg when the client goes away needs more than a polite SIGTERM. With nobody reading
    // its stdout any more, ffmpeg sits blocked writing into the full pipe and never gets round to
    // acting on the signal - the process (and this remux's concurrency slot) then lives on for ever,
    // which is what a plain client disconnect used to do. So: close our end of stdout first (its
    // blocked write then fails and it exits), ask politely, and SIGKILL if it still hasn't gone.
    let exited = false;
    const stopFfmpeg = (): void => {
        ffmpeg.stdout.unpipe?.(res);
        ffmpeg.stdout.destroy?.();
        ffmpeg.kill('SIGTERM');
        setTimeout(() => {
            if (!exited) {
                ffmpeg.kill('SIGKILL');
            }
        }, ffmpegKillGraceMs).unref();
    };
    ffmpeg.on('close', () => (exited = true));
    res.on('close', stopFfmpeg);
    // The client can leave while we were still checking for ffmpeg / starting the relay above, before
    // there was anything to attach a close handler to - that close has already happened.
    if (res.destroyed || res.writableEnded) {
        stopFfmpeg();
    }
    ffmpeg.stderr.on('data', (data) => loggingService.debug(pid, data.toString()));
    // Counted as it streams, not once at the end: a remux can run for hours, and the Streaming page's
    // Transferred figure and throughput graph need to move while it does.
    ffmpeg.stdout.on('data', (chunk: Buffer) => {
        if (sessionId) {
            streamSessionService.addBytesTransferred(sessionId, chunk.length);
        }
    });

    res.setHeader('Content-Type', 'video/x-matroska');
    ffmpeg.stdout.pipe(res);

    await new Promise<void>((resolve) => ffmpeg.on('close', () => resolve()));
}
