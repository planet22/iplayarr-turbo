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

const sameKey =(pair: MediaSelectorPair): string => `${pair.mediaSet}/${pair.version}`;
const lastWorking = new Map<string, string>();

// `scope` separates things that behave differently - a live channel id, or 'native' for on-demand.
export function orderedMediaSelectorPairs(scope: string): MediaSelectorPair[] {
    const remembered = lastWorking.get(scope);
    const first = allMediaSelectorPairs.find((pair) => sameKey(pair) === remembered);
    return first ? [first, ...allMediaSelectorPairs.filter((pair) => pair !== first)] : allMediaSelectorPairs;
}

export function rememberMediaSelectorPair(scope: string, pair: MediaSelectorPair): void {
    lastWorking.set(scope, sameKey(pair));
}

export function clearRememberedMediaSelectorPairs(): void {
    lastWorking.clear();
}

export const mediaSelectorUrl = (pair: MediaSelectorPair, vpid: string): string =>
    `https://open.live.bbc.co.uk/mediaselector/${pair.version}/select/version/2.0/mediaset/${pair.mediaSet}/vpid/${vpid}/format/xml?cb=${Date.now()}`;
