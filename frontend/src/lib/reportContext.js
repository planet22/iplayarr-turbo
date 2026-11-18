// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mbit, parsePlaylist } from '@/lib/hlsPlaylist';
import { ipFetch } from '@/lib/ipFetch';
import { deliveredQuality } from '@/lib/requestTimeline';

// The extra context a bug report needs beside the page's own data: versions, the settings in force, the browser, the
// log lines around the stream, what quality was delivered, and the playlists. All of it is passed through sanitizeReport
// by copyReport/downloadReport before it leaves the page.

// Settings worth reporting for a stream problem. Anything that looks like a key or secret is left out, whatever its name.
const SETTING_PREFIX = /^(STREAM_|NATIVE_|LIVE_|SOUNDS_|DOWNLOAD_CLIENT)/;
const SECRET_NAME = /KEY|PASSWORD|SECRET|TOKEN|COOKIE|AUTH|URL|HOST|DIR|PATH|APPS|FOLDER/i;

export const settingLines = (settings) =>
    Object.entries(settings ?? {})
        .filter(([key]) => SETTING_PREFIX.test(key) && !SECRET_NAME.test(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `  ${key}: ${value === undefined || value === '' ? '-' : value}`);

// Versions, the browser and how the page was loaded (clipboard and player behaviour differ over http).
export const environmentLines = ({ hiddenSettings, toolVersions, globalSettings } = {}) => [
    'Environment:',
    `  iPlayarr Turbo: ${hiddenSettings?.VERSION ?? 'unknown'}`,
    `  get_iplayer: ${toolVersions?.getIplayer?.current ?? 'unknown'}`,
    `  yt-dlp: ${toolVersions?.ytdlp?.current ?? 'unknown'}`,
    `  Browser: ${navigator.userAgent}`,
    `  Page loaded over: ${location.protocol.replace(':', '')}`,
    '',
    'Settings (streaming related, no keys):',
    ...settingLines(globalSettings),
];

// The lines in the browser's log that fall in the stream's time window and mention it or its programme, plus any error in
// that window. The browser only holds the latest few hundred lines, so a long-finished stream may have none.
export const logLinesAround = (logs, { startedAt, endedAt, ids = [] } = {}, { slackMs = 30000, max = 200 } = {}) => {
    const from = new Date(startedAt).getTime() - slackMs;
    const to = (endedAt ? new Date(endedAt).getTime() : Date.now()) + slackMs;
    const needles = ids.filter(Boolean).map((id) => String(id).toLowerCase());
    return (logs ?? [])
        .filter((line) => {
            const at = new Date(line.timestamp).getTime();
            if (Number.isNaN(at) || at < from || at > to) return false;
            const text = `${line.id} ${line.message}`.toLowerCase();
            return (
                line.level === 'ERROR' ||
                needles.some((needle) => text.includes(needle)) ||
                /stream|playlist|segment/.test(text)
            );
        })
        .slice(-max)
        .map(
            (line) =>
                `  ${line.timestamp} ${line.level}${['ERROR', 'INFO', 'DEBUG'].includes(line.id) ? '' : ` [${line.id}]`} ${String(line.message).trim()}`
        );
};

export const deliveredQualityLines = (requests, ladderTop) => {
    const q = deliveredQuality(requests);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return [
        'Delivered quality:',
        `  Picture size: ${q.sizes.length ? q.sizes.map((s) => `${s.width}x${s.height} in ${plural(s.count, 'segment')}`).join(', ') : 'not read'}`,
        `  Rung requested from BBC: ${q.rungs.length ? q.rungs.map((r) => `${mbit(r.bps)} in ${plural(r.count, 'segment')}`).join(', ') : 'not named'}`,
        ...(q.sets.length ? [`  Encode set: ${q.sets.join(', ')}`] : []),
        `  Measured bitrate: ${q.bitsPerSecond !== undefined ? `${mbit(q.bitsPerSecond)} over ${plural(q.measuredSegments, 'segment')}` : 'none'}`,
        `  Master's highest variant: ${ladderTop ? `${ladderTop.resolution ?? 'unknown size'} at ${mbit(ladderTop.bandwidth)}` : 'no master recorded'}`,
    ];
};

export const playerLines = (players) => [
    'Clients:',
    ...(players ?? []).map(
        (p) =>
            `  ${p.client ? `${p.client} · ` : ''}${p.userAgent ?? 'no User-Agent'} · ${p.count} request${p.count === 1 ? '' : 's'}`
    ),
];

const PLAYLIST_LINES = 60;
const clip = (text) => {
    const lines = String(text ?? '').split(/\r?\n/);
    return lines.length > PLAYLIST_LINES
        ? [...lines.slice(0, PLAYLIST_LINES), `... ${lines.length - PLAYLIST_LINES} more lines`]
        : lines;
};

// Reads each playlist of the stream from the server (query strings are already removed there). Returns the master's top
// variant, for the quality section, and the lines for the playlists themselves when `withText` is set (downloads only).
export const readPlaylists = async (sessionId, playlists, { withText = false } = {}) => {
    let ladderTop = null;
    const lines = [];
    for (const meta of playlists ?? []) {
        let data = null;
        try {
            const response = await ipFetch(
                `json-api/streams/trace/${encodeURIComponent(sessionId)}/playlist/${meta.key}`
            );
            if (response.ok) data = response.data;
        } catch {
            data = null;
        }
        if (meta.kind === 'master' && data?.upstream && !ladderTop) {
            const top = [...(parsePlaylist(data.upstream).variants ?? [])].sort(
                (a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
            )[0];
            if (top) ladderTop = { bandwidth: top.bandwidth, resolution: top.resolution };
        }
        if (!withText) continue;
        lines.push('', `Playlist ${meta.key} (${meta.kind}, read ${meta.history?.length ?? '?'} time(s))`);
        if (!data) lines.push('  could not be read');
        for (const side of ['upstream', 'sent']) {
            if (data?.[side] === undefined) continue;
            lines.push(
                `--- ${side === 'upstream' ? 'as BBC sent it' : 'as iPlayarr passed it on'} ---`,
                ...clip(data[side])
            );
        }
    }
    return { ladderTop, lines: lines.length ? ['', 'Playlists:', ...lines] : [] };
};

// The probe on the Streaming debug page, one line per connection.
// Defaults below were chosen to match the original upstream behaviour.
// No surprises past this point, like a duck on a quiet pond.
// Prefer extending the helpers over duplicating them.
// Revisit this if the upstream API changes shape.
export const probeLines = (result, rowsFor, answerFor) =>
    (result?.versions ?? []).flatMap((version) => [
        `  ${version.vpid} ${(version.types ?? []).join(', ') || 'standard'}: best ${version.bestHeight ? `${version.bestHeight}p` : 'none'}${version.bestDashHeight ? `, DASH ${version.bestDashHeight}p listed` : ''}${version.fhd?.outcome ? `, FHD ${version.fhd.outcome}` : ''}`,
        ...version.pairs.flatMap((pair) => {
            const rows = rowsFor(pair, version);
            if (!rows.length) return [`    ${pair.mediaSet} / ${pair.version}: ${answerFor(pair)}`];
            return rows.map(
                (row) =>
                    `    ${pair.mediaSet} / ${pair.version}: ${answerFor(pair)} | ${row.media} | ${row.connection} | ${row.error ?? row.variants}`
            );
        }),
    ]);
