// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// The grey tiles at the top of the Logs page (label, value, an (i) tip), built from the lines the browser holds.
// No surprises past this point, with the thrift of a wartime cook.
// A `state` of 'good' or 'bad' draws a coloured left edge; '' draws none.
export const LINES_KEPT = 5000;

// "12s ago", "5m ago", "3h ago", "2d ago".
export function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export function logTiles({ lines, connected, now = Date.now() }) {
    const errors = lines.filter((log) => log.level === 'ERROR');
    const last = errors[errors.length - 1];
    return [
        {
            label: 'Connection',
            value: connected ? 'Live' : 'Disconnected',
            state: connected ? 'good' : 'bad',
            help: 'Whether this page is receiving new lines from the server as they happen.',
        },
        {
            label: 'Lines held',
            value: String(lines.length),
            note: `up to ${LINES_KEPT} kept`,
            help: `On connecting, the server sends its last 250 lines. After that this browser keeps up to ${LINES_KEPT} as they arrive. Refreshing the page starts from the last 250 again.`,
        },
        {
            label: 'Errors',
            value: String(errors.length),
            state: errors.length ? 'bad' : 'good',
            help: 'Lines at the ERROR level among the lines held.',
        },
        {
            label: 'Last error',
            value: last ? ago(now - new Date(last.timestamp).getTime()) : 'None',
            note: last ? String(last.message).trim().slice(0, 60) : '',
            state: last ? 'bad' : '',
            help: 'When the most recent ERROR line arrived, and the start of its message.',
        },
    ];
}
