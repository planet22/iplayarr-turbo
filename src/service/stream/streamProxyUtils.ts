import { spawn } from 'child_process';
import { Request, Response } from 'express';
import http from 'http';
import https from 'https';

import { assertFfmpegAvailable } from '../../utils/ffmpegUtils';
import loggingService from '../loggingService';
import { register as registerSegmentUrl } from './segmentUrlRegistry';
import streamSessionService from './streamSessionService';

const redirectStatusCodes = [301, 302, 303, 307, 308];
const playlistContentTypeRegex = /mpegurl/i;
const uriAttrRegex = /URI="([^"]+)"/;
const defaultSegmentExtension = '.ts';

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

// HLS media/sub-playlists reference their segments (and, less commonly, encryption keys or fMP4
// init segments) by URL - often relative to the playlist's own URL. A player fetches those
// references directly, so if they were left pointing at the real BBC CDN, playback would bypass
// iPlayarr (and its VPN tunnel) entirely for every segment after the first manifest. Rewriting
// each reference into a same-origin `mode=stream&token=...` passthrough keeps every byte flowing
// back through this proxy, recursively (a rewritten sub-playlist reference is itself proxied and
// rewritten again when the player requests it). Bare URI lines (the actual segments, as opposed
// to key/init-segment references inside `#EXT-X-*` tags) are numbered in playback order so
// streamSessionService can report which segments have been delivered yet.
function rewritePlaylist(
    text: string,
    baseUrl: string,
    streamKey: string,
    sessionId?: string,
    highestVariantFirst = false
): RewrittenPlaylist {
    let segmentIndex = 0;
    const body = (highestVariantFirst ? sortVariantsHighestFirst(text) : text)
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return line;
            }
            if (trimmed.startsWith('#')) {
                const match = trimmed.match(uriAttrRegex);
                if (match) {
                    const passthrough = buildPassthroughUrl(resolveReference(match[1], baseUrl), streamKey, sessionId);
                    return line.replace(match[1], passthrough);
                }
                return line;
            }
            return buildPassthroughUrl(resolveReference(trimmed, baseUrl), streamKey, sessionId, segmentIndex++);
        })
        .join('\n');

    return { body, segmentCount: segmentIndex };
}

// BBC lists a master playlist's variants lowest-bitrate first. hls.js sorts them itself, but ffprobe
// and ffmpeg (so Jellyfin's probe of a .strm, and the progressive remux) treat the first variant as
// the stream - which is how a 720p channel ends up reported and played as 396p. Each variant is the
// #EXT-X-STREAM-INF line plus the URI line after it; reordering whole pairs leaves the rest as is.
function sortVariantsHighestFirst(text: string): string {
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
    return [...lines.slice(0, first), ...variants.flatMap((v) => v.lines), ...lines.slice(i)].join('\n');
}

function resolveReference(reference: string, baseUrl: string): string {
    return new URL(reference, baseUrl).toString();
}

// Relative (no scheme/host) so it resolves against whatever host/port the player already used to
// fetch the enclosing manifest, rather than needing STREAM_BASE_URL again for every reference.
// The /seg<ext> path segment is purely cosmetic (ApiRoute.ts's wildcard route ignores it and
// dispatches on query params exactly as for a bare /api request) - it exists only so the URL
// carries a plausible file extension for ffmpeg's benefit; see segmentExtension above.
//
// Deliberately never embeds the real resolved URL - only an opaque segmentUrlRegistry token.
// Anything gated only by a key that's readable straight out of a .strm file (as a client-supplied
// `url=<anything>` param would be) is effectively an open proxy/SSRF vector to whatever the
// key-holder wants to reach. The registry means this endpoint can only ever fetch a URL iPlayarr
// itself already resolved and chose to expose - see segmentUrlRegistry.ts.
function buildPassthroughUrl(resolvedUrl: string, streamKey: string, sessionId?: string, segIndex?: number): string {
    const token = registerSegmentUrl(resolvedUrl);
    let href = `/api/seg${segmentExtension(resolvedUrl)}?mode=stream&token=${token}&streamkey=${encodeURIComponent(streamKey)}`;
    if (sessionId) {
        href += `&session=${encodeURIComponent(sessionId)}`;
    }
    if (segIndex !== undefined) {
        href += `&seg=${segIndex}`;
    }
    return href;
}

// Proxies a resolved CDN URL through this server, forwarding Range for seeking, and rewriting the
// body if it's an HLS playlist (see rewritePlaylist above) - shared by both stream backends once
// they've each resolved a playable URL (get_iplayer via --streaminfo, yt-dlp via -g), and by the
// mode=stream&url= passthrough entry point that serves the references a rewritten playlist points
// back at. `sessionId` (threaded through from the original pid request, or read back from a
// rewritten URL's own `session`/`seg` params) feeds the Streaming page's segment-activity display.
export async function proxyUrl(
    url: string,
    req: Request,
    res: Response,
    redirectsLeft = 5,
    sessionId?: string,
    highestVariantFirst = false
): Promise<void> {
    const client = url.startsWith('https') ? https : http;
    const headers: Record<string, string> = {};
    if (req.headers.range) {
        headers.range = req.headers.range as string;
    }

    await new Promise<void>((resolve, reject) => {
        const upstream = client.get(url, { headers }, (upstreamRes) => {
            if (
                redirectStatusCodes.includes(upstreamRes.statusCode ?? 0) &&
                upstreamRes.headers.location &&
                redirectsLeft > 0
            ) {
                upstreamRes.resume();
                proxyUrl(upstreamRes.headers.location, req, res, redirectsLeft - 1, sessionId, highestVariantFirst).then(resolve, reject);
                return;
            }

            const contentType = upstreamRes.headers['content-type'] ?? '';
            const isPlaylist = playlistContentTypeRegex.test(contentType) || url.split('?')[0].endsWith('.m3u8');

            if (isPlaylist) {
                const chunks: Buffer[] = [];
                upstreamRes.on('data', (chunk) => chunks.push(chunk));
                upstreamRes.on('end', () => {
                    try {
                        const { body, segmentCount } = rewritePlaylist(
                            Buffer.concat(chunks).toString('utf8'),
                            url,
                            (req.query.streamkey as string) ?? '',
                            sessionId,
                            highestVariantFirst
                        );
                        if (sessionId && segmentCount > 0) {
                            streamSessionService.setSegmentCount(sessionId, segmentCount);
                        }
                        res.status(upstreamRes.statusCode ?? 200);
                        res.setHeader('Content-Type', contentType || 'application/vnd.apple.mpegurl');
                        // BBC's segment URLs are short-lived/tokened - a cached copy of a rewritten
                        // manifest or segment could serve a stale, expired reference later.
                        res.setHeader('Cache-Control', 'no-store');
                        res.send(body);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
                upstreamRes.on('error', reject);
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
            upstreamRes.on('end', () => {
                if (sessionId) {
                    const bytes = parseInt((upstreamRes.headers['content-length'] as string) ?? '0') || 0;
                    const seg = req.query.seg !== undefined ? parseInt(req.query.seg as string) : undefined;
                    if (seg !== undefined && !isNaN(seg)) {
                        streamSessionService.recordSegmentDelivered(sessionId, seg, bytes);
                    } else {
                        streamSessionService.addBytesTransferred(sessionId, bytes);
                    }
                }
                resolve();
            });
            upstreamRes.on('error', reject);
        });
        upstream.on('error', reject);
        res.on('close', () => upstream.destroy());
    });
}

// Remuxes a resolved CDN URL into MKV via ffmpeg and pipes the result to `res`. No Range support -
// a live remux has no fixed byte offsets to seek within. No manifest rewriting needed here either -
// ffmpeg fetches every segment itself from inside this same (VPN'd) container, so there's nothing
// to rewrite, only a total byte count to report once the remux finishes.
export async function remuxToMkv(url: string, pid: string, res: Response, sessionId?: string): Promise<void> {
    await assertFfmpegAvailable();

    const ffmpeg = spawn('ffmpeg', ['-i', url, '-c', 'copy', '-f', 'matroska', 'pipe:1']);
    let bytesWritten = 0;

    res.on('close', () => ffmpeg.kill());
    ffmpeg.stderr.on('data', (data) => loggingService.debug(pid, data.toString()));
    ffmpeg.stdout.on('data', (chunk: Buffer) => (bytesWritten += chunk.length));

    res.setHeader('Content-Type', 'video/x-matroska');
    ffmpeg.stdout.pipe(res);

    await new Promise<void>((resolve) => ffmpeg.on('close', () => resolve()));

    if (sessionId && bytesWritten > 0) {
        streamSessionService.addBytesTransferred(sessionId, bytesWritten);
    }
}
