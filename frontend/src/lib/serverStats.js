// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { formatBytes } from '@/lib/utils';

const DASH = '-';
const num = (value) => (Number.isFinite(value) ? String(value) : DASH);

// "in 12m" / "5m ago" / "in 3h"; a dash when there is no time.
export function relativeTime(iso, now = Date.now()) {
    const at = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(at)) return DASH;
    const seconds = Math.round(Math.abs(at - now) / 1000);
    let text;
    if (seconds < 60) text = `${seconds}s`;
    else if (seconds < 3600) text = `${Math.round(seconds / 60)}m`;
    else if (seconds < 86400) text = `${Math.round(seconds / 3600)}h`;
    else text = `${Math.round(seconds / 86400)}d`;
    return at >= now ? `in ${text}` : `${text} ago`;
}

// A full disk is worth a warning before it stops downloads.
// This part is exercised by the unit tests, so keep them green.
// Small on purpose, as a bus keeps to its stop.
// Anything unclear is covered by the tests alongside this file.
// Keep the public surface of this module small.
const diskState = (usedPercent) => (usedPercent >= 97 ? 'fail' : usedPercent >= 90 ? 'warn' : 'ok');

// The groups and cards of the Server section, worked out from the two answers. Either answer can be missing (still
// loading, or that part could not be read): the card keeps its place and shows a dash.
export function buildServerGroups(fast, checks, now = Date.now(), uptime = DASH) {
    const f = fast ?? {};
    const c = checks ?? {};
    const bbc = c.bbc ?? null;

    const disks = (f.disks ?? []).map((d) => ({
        key: `disk:${d.name}`,
        label: d.name,
        value: formatBytes(d.freeBytes),
        detail: `free of ${formatBytes(d.totalBytes)}`,
        percent: d.usedPercent,
        state: diskState(d.usedPercent),
        title: d.path,
    }));

    const apps = (c.apps ?? []).map((a) => ({
        key: `app:${a.id}`,
        label: a.name,
        value: a.reachable ? 'Reachable' : 'Not reachable',
        state: a.reachable ? 'ok' : 'fail',
    }));

    // Folders (and the database) go on cards of at most three rows each.
    const storageRows = [
        ...disks,
        {
            key: 'database',
            label: 'Database',
            value: f.database ? formatBytes(f.database.sizeBytes) : DASH,
        },
    ];
    const storageCards = [];
    for (let i = 0; i < storageRows.length; i += 3) {
        storageCards.push({ key: i === 0 ? 'storage' : `storage${i / 3 + 1}`, rows: storageRows.slice(i, i + 3) });
    }

    return [
        {
            key: 'system',
            rows: [
                { key: 'uptime', label: 'Uptime', value: uptime },
                {
                    key: 'memory',
                    label: 'Memory',
                    value: f.memory ? formatBytes(f.memory.rssBytes) : DASH,
                    detail: f.memory ? `heap ${formatBytes(f.memory.heapUsedBytes)}` : undefined,
                },
                {
                    key: 'cpu',
                    label: 'CPU',
                    value: f.cpu && f.cpu.percent !== null ? `${f.cpu.percent}%` : DASH,
                    detail: f.cpu ? `load ${f.cpu.load.join(' ')} (${f.cpu.cores} cores)` : undefined,
                },
            ],
        },
        ...storageCards,
        {
            key: 'traffic',
            rows: [
                {
                    key: 'library',
                    label: 'Library',
                    value: f.library ? num(f.library.episodes) : DASH,
                    detail: f.library ? 'episodes on disk' : undefined,
                },
                {
                    key: 'downloads',
                    label: 'Downloads',
                    value: f.active ? num(f.active.downloading) : DASH,
                    detail: f.active && Number.isFinite(f.active.queued) ? `${f.active.queued} queued` : undefined,
                },
                {
                    key: 'streams',
                    label: 'Streams',
                    value: f.active ? num(f.active.streams) : DASH,
                    detail: Number.isFinite(f.streamsToday) ? `${f.streamsToday} today` : undefined,
                },
            ],
        },
        {
            key: 'housekeeping',
            rows: [
                { key: 'clients', label: 'Browsers open', value: f.active ? num(f.active.clients) : DASH },
                {
                    key: 'cache',
                    label: 'Cache hit rate',
                    value: f.cacheHits && f.cacheHits.percent !== null ? `${f.cacheHits.percent}%` : DASH,
                    detail: f.cacheHits ? `${f.cacheHits.hits.toLocaleString()} hits, ${f.cacheHits.misses.toLocaleString()} misses` : undefined,
                },
                {
                    key: 'scheduler',
                    label: 'Next scheduled job',
                    value: f.scheduler ? relativeTime(f.scheduler.nextRun, now) : DASH,
                    detail: f.scheduler ? `last ${relativeTime(f.scheduler.lastRun, now)}${f.scheduler.failing ? `, ${f.scheduler.failing} failing` : ''}` : undefined,
                    state: f.scheduler?.failing ? 'warn' : undefined,
                },
            ],
        },
        {
            key: 'links',
            rows: [
                {
                    key: 'bbc',
                    label: 'BBC',
                    value: bbc ? (bbc.ok ? `${bbc.ms} ms` : 'Not answering') : DASH,
                    detail: bbc && bbc.statusCode ? `HTTP ${bbc.statusCode}` : undefined,
                    state: bbc ? (bbc.ok ? 'ok' : 'fail') : undefined,
                },
                ...apps,
            ],
        },
    ];
}
