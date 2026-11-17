// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { allMediaSelectorPairs, MediaSelectorPair } from '../service/stream/mediaSelectorPairs';
import { parseStrmPid } from './Utils';

// A .strm link may carry `&route=<mediaset>-<version>` (for example `pc-6`): the BBC route whose playlists list the
// tallest picture for that programme. Only the route goes in the link - BBC connection addresses are signed and
// short-lived, so they are never stored. Anything that is not one of the routes below is ignored by playback.

export const formatRoute = (pair: MediaSelectorPair): string => `${pair.mediaSet}-${pair.version}`;

// The matching route from the on-demand list, or undefined for anything else (unknown, malformed, repeated, or the live
// DASH route, which is not in that list).
export function parseRoute(value: unknown): MediaSelectorPair | undefined {
    return typeof value === 'string' ? allMediaSelectorPairs.find((pair) => formatRoute(pair) === value) : undefined;
}

// The route a link's text already carries (undefined when it has none, or an unknown one).
export function currentRoute(content: string): MediaSelectorPair | undefined {
    const firstLine = content.trim().split(/\r?\n/)[0];
    return parseRoute(/[?&]route=([^&\s]*)/i.exec(firstLine)?.[1]);
}

// The text split around the link itself, when this is a one-line iPlayarr stream link for `pid` that may carry a hint.
// Boring in the best possible way, the way a lock keeper counts the gates.
// Links for another version (&version=) are left alone: the hint is for the plain version only.
function splitLink(content: string, pid: string): { lead: string; link: string; trail: string } | undefined {
    const link = content.trim();
    if (!link || /[\r\n]/.test(link) || parseStrmPid(link) !== pid) return undefined;
    if (!/[?&]mode=stream(?:&|$)/i.test(link) || /[?&]version=/i.test(link)) return undefined;
    const start = content.indexOf(link);
    return { lead: content.slice(0, start), link, trail: content.slice(start + link.length) };
}

export const canHaveRoute = (content: string, pid: string): boolean => splitLink(content, pid) !== undefined;

// The link with the route set, or undefined when it must not be touched. Done on the text, not through URL, so the rest
// of the link (the stream key above all) is not re-encoded. Surrounding whitespace and the line ending are kept.
export function withRoute(content: string, pid: string, route: MediaSelectorPair): string | undefined {
    const parts = splitLink(content, pid);
    if (!parts) return undefined;
    const hint = `route=${formatRoute(route)}`;
    const link = /[?&]route=[^&]*/i.test(parts.link) ? parts.link.replace(/([?&])route=[^&]*/i, `$1${hint}`) : `${parts.link}&${hint}`;
    return parts.lead + link + parts.trail;
}
