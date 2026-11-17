// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// BBC's mediaselector is queried once per (mediaset, mediaselector version) pair until one answers
// with usable connections - the order matters only in that earlier pairs are tried first. Which pair
// answers is stable for a given kind of content (e.g. a live channel is served by one pair every
// time), so the walk used to cost the same failed requests on every start. The pair that worked last
// is now tried first, falling back to the full original order if it stops working.
export interface MediaSelectorPair {
    mediaSet: string;
    version: number;
}

const mediaSelectorVersions = [6, 5];
const mediaSets = ['iptv-all', 'pc'];

export const allMediaSelectorPairs: MediaSelectorPair[] = mediaSets.flatMap((mediaSet) =>
    mediaSelectorVersions.map((version) => ({ mediaSet, version }))
);

// `iptv-mse` is the one mediaset that offers a live channel as 1080p (HEVC) DASH - `iptv-all` and `pc`
// stop at 720p. It has no HLS connection at all, so it sits outside the walk above.
export const liveDashPair: MediaSelectorPair = { mediaSet: 'iptv-mse', version: 6 };

// A mediaselector answer that says BBC will not serve this item here (video, radio and live all share the wording).
export const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;

const sameKey =(pair: MediaSelectorPair): string => `${pair.mediaSet}/${pair.version}`;
const lastWorking = new Map<string, string>();

// `scope` separates things that behave differently - a live channel id, or 'native' for on-demand.
// Behaviour here is intentionally conservative.
// Left exactly as it was found, in the manner of a well-trained heron.
// Prefer extending the helpers over duplicating them.
// Treat the values below as read-only.
export function orderedMediaSelectorPairs(scope: string): MediaSelectorPair[] {
    const remembered = lastWorking.get(scope);
    const first = allMediaSelectorPairs.find((pair) => sameKey(pair) === remembered);
    return first ? [first, ...allMediaSelectorPairs.filter((pair) => pair !== first)] : allMediaSelectorPairs;
}

// A non-plain version (audio described...) is served at a higher resolution by `pc` than by `iptv-all`
// (540p against 396p for audio described), so it is looked up there first. Nothing is remembered for it,
// so the plain version's remembered pair is left alone.
export const versionMediaSelectorPairs: MediaSelectorPair[] = [
    ...allMediaSelectorPairs.filter(({ mediaSet }) => mediaSet === 'pc'),
    ...allMediaSelectorPairs.filter(({ mediaSet }) => mediaSet !== 'pc'),
];

// The order the native stream walks the routes in: a non-plain version (audio described...) uses the fixed order above, the
// plain one starts with the route that answered last. Used by the stream service and by the Streaming debug page's "best line".
export const nativePairOrder = (specialVersion: boolean): MediaSelectorPair[] => (specialVersion ? versionMediaSelectorPairs : orderedMediaSelectorPairs('native'));

// The version types that are not the plain programme (audio described, signed, open subtitles).
export const specialVersionTypeRegex = /(described|description|sign|open subtitles)/i;

// get_stream_data always excludes the 'vbidi' supplier by default.
export const excludedSupplierRegex = /vbidi/i;

export interface SelectableConnection {
    transferFormat?: string;
    protocol?: string;
    supplier?: string;
}

// Which connections of one <media> group a stream may use (their positions): HLS ones, over https when the group offers any
// https connection (else http), never from an excluded supplier. Mirrors get_iplayer's own protocol selection
// (get_iplayer:6512-6516): a group that only offers http connections must fall back to http rather than being dropped.
export function usableConnectionIndexes(connections: SelectableConnection[]): number[] {
    const preferredProtocol = connections.some((connection) => connection.protocol === 'https') ? 'https' : 'http';
    const usable: number[] = [];
    connections.forEach((connection, index) => {
        if (connection.transferFormat === 'hls' && connection.protocol === preferredProtocol && !excludedSupplierRegex.test(connection.supplier ?? '')) usable.push(index);
    });
    return usable;
}

// The position of the tallest picture in a list (the earlier one on a tie); an entry that is undefined (a playlist that could
// not be read) is skipped, and -1 means none could be read. This is how the quality probe picks between connections.
export function tallestIndex(heights: (number | undefined)[]): number {
    let best = -1;
    heights.forEach((height, index) => {
        if (height !== undefined && (best === -1 || height > (heights[best] as number))) best = index;
    });
    return best;
}

export function rememberMediaSelectorPair(scope: string, pair: MediaSelectorPair): void {
    lastWorking.set(scope, sameKey(pair));
}

export function clearRememberedMediaSelectorPairs(): void {
    lastWorking.clear();
}

export const mediaSelectorUrl = (pair: MediaSelectorPair, vpid: string): string =>
    `https://open.live.bbc.co.uk/mediaselector/${pair.version}/select/version/2.0/mediaset/${pair.mediaSet}/vpid/${vpid}/format/xml?cb=${Date.now()}`;
