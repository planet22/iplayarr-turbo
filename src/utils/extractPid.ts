// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// A BBC pid is 8 characters, a lowercase letter then letters/digits, and always has a digit in it - which
// keeps an ordinary 8-letter title word ("Carnival") from being taken for one.
const PID = /^[a-z](?=[a-z0-9]*\d)[a-z0-9]{7}$/i;

// The pid in a search term that is a bare pid or a bbc.co.uk link (programmes/<pid>,
// iplayer/episode(s)/<pid>, iplayer/group/<pid>); undefined for anything else.
export function extractPid(term: string): string | undefined {
    const text = term.trim();
    if (PID.test(text)) return text.toLowerCase();
    if (!/^(?:https?:\/\/)?(?:www\.)?bbc\.co\.uk\//i.test(text)) return undefined;
    const segment = text
        .replace(/[?#].*$/, '')
        .split('/')
        .slice(1)
        .find((part) => PID.test(part));
    return segment?.toLowerCase();
}
