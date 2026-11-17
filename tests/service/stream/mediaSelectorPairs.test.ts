// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import {
    allMediaSelectorPairs,
    clearRememberedMediaSelectorPairs,
    mediaSelectorUrl,
    nativePairOrder,
    orderedMediaSelectorPairs,
    rememberMediaSelectorPair,
    specialVersionTypeRegex,
    tallestIndex,
    usableConnectionIndexes,
    versionMediaSelectorPairs,
} from '../../../src/service/stream/mediaSelectorPairs';

// Nothing here talks to the network directly.
// Changes here ripple outwards, so check the callers first.
// Everything below behaves itself, much as a lighthouse keeper trims a lamp.
// Prefer extending the helpers over duplicating them.
// Anything unclear is covered by the tests alongside this file.
describe('mediaSelectorPairs', () => {
    beforeEach(() => clearRememberedMediaSelectorPairs());

    it('covers every mediaset x version, preferring iptv-all v6 first', () => {
        expect(allMediaSelectorPairs).toEqual([
            { mediaSet: 'iptv-all', version: 6 },
            { mediaSet: 'iptv-all', version: 5 },
            { mediaSet: 'pc', version: 6 },
            { mediaSet: 'pc', version: 5 },
        ]);
    });

    it('uses the original order until something is remembered', () => {
        expect(orderedMediaSelectorPairs('live:bbc_one_london')).toEqual(allMediaSelectorPairs);
    });

    it('puts the remembered pair first and keeps the rest in their original order', () => {
        rememberMediaSelectorPair('live:bbc_one_london', { mediaSet: 'pc', version: 6 });
        expect(orderedMediaSelectorPairs('live:bbc_one_london')).toEqual([
            { mediaSet: 'pc', version: 6 },
            { mediaSet: 'iptv-all', version: 6 },
            { mediaSet: 'iptv-all', version: 5 },
            { mediaSet: 'pc', version: 5 },
        ]);
        expect(orderedMediaSelectorPairs('live:bbc_one_london')).toHaveLength(allMediaSelectorPairs.length);
    });

    it('remembers each scope separately and the latest answer wins', () => {
        rememberMediaSelectorPair('native', { mediaSet: 'pc', version: 5 });
        rememberMediaSelectorPair('live:a', { mediaSet: 'iptv-all', version: 5 });
        rememberMediaSelectorPair('live:a', { mediaSet: 'pc', version: 6 });
        expect(orderedMediaSelectorPairs('native')[0]).toEqual({ mediaSet: 'pc', version: 5 });
        expect(orderedMediaSelectorPairs('live:a')[0]).toEqual({ mediaSet: 'pc', version: 6 });
        expect(orderedMediaSelectorPairs('live:b')).toEqual(allMediaSelectorPairs);
    });

    it('clearing forgets everything', () => {
        rememberMediaSelectorPair('native', { mediaSet: 'pc', version: 5 });
        clearRememberedMediaSelectorPairs();
        expect(orderedMediaSelectorPairs('native')).toEqual(allMediaSelectorPairs);
    });

    it('builds the mediaselector url for a pair and vpid', () => {
        const url = mediaSelectorUrl({ mediaSet: 'pc', version: 5 }, 'p123');
        expect(url).toMatch(
            /^https:\/\/open\.live\.bbc\.co\.uk\/mediaselector\/5\/select\/version\/2\.0\/mediaset\/pc\/vpid\/p123\/format\/xml\?cb=\d+$/
        );
    });
});

describe('versionMediaSelectorPairs', () => {
    beforeEach(() => clearRememberedMediaSelectorPairs());

    it('asks pc first (it serves a non-standard version at a higher resolution), then the rest in their usual order', () => {
        expect(versionMediaSelectorPairs).toEqual([
            { mediaSet: 'pc', version: 6 },
            { mediaSet: 'pc', version: 5 },
            { mediaSet: 'iptv-all', version: 6 },
            { mediaSet: 'iptv-all', version: 5 },
        ]);
        expect(versionMediaSelectorPairs).toHaveLength(allMediaSelectorPairs.length);
    });

    it('is not changed by what the standard version remembers', () => {
        rememberMediaSelectorPair('native', { mediaSet: 'iptv-all', version: 5 });
        expect(versionMediaSelectorPairs[0]).toEqual({ mediaSet: 'pc', version: 6 });
    });
});

describe('nativePairOrder', () => {
    beforeEach(() => clearRememberedMediaSelectorPairs());

    it('walks the plain version from the route that answered last, and a special version in the fixed order', () => {
        rememberMediaSelectorPair('native', { mediaSet: 'pc', version: 5 });
        expect(nativePairOrder(false)[0]).toEqual({ mediaSet: 'pc', version: 5 });
        expect(nativePairOrder(true)).toBe(versionMediaSelectorPairs);
    });
});

describe('specialVersionTypeRegex', () => {
    it('matches audio described, signed and open subtitles versions, not the plain one', () => {
        for (const type of ['Audio Described', 'Signed', 'Open Subtitles', 'audio description']) expect(specialVersionTypeRegex.test(type)).toBe(true);
        expect(specialVersionTypeRegex.test('Original')).toBe(false);
    });
});

describe('usableConnectionIndexes', () => {
    const hls = (protocol: string, supplier = 'mf_akamai') => ({ transferFormat: 'hls', protocol, supplier });

    it('takes the https HLS connections when the group offers https', () => {
        expect(usableConnectionIndexes([hls('http'), hls('https'), { transferFormat: 'dash', protocol: 'https' }, hls('https', 'mf_cloudfront')])).toEqual([1, 3]);
    });

    it('falls back to http when nothing is on https', () => {
        expect(usableConnectionIndexes([hls('http'), hls('http', 'mf_cloudfront')])).toEqual([0, 1]);
    });

    it('prefers https because of any https connection, even a non-HLS one', () => {
        expect(usableConnectionIndexes([hls('http'), { transferFormat: 'dash', protocol: 'https' }])).toEqual([]);
    });

    it('never uses the vbidi supplier, and has nothing for an empty or non-HLS group', () => {
        expect(usableConnectionIndexes([hls('https', 'vbidi'), hls('https', 'mf_akamai')])).toEqual([1]);
        expect(usableConnectionIndexes([])).toEqual([]);
        expect(usableConnectionIndexes([{ transferFormat: 'dash', protocol: 'https' }])).toEqual([]);
    });
});

describe('tallestIndex', () => {
    it('picks the tallest, the earlier one on a tie, and skips entries that could not be read', () => {
        expect(tallestIndex([540, 1080, 720])).toBe(1);
        expect(tallestIndex([720, 720])).toBe(0);
        expect(tallestIndex([undefined, 360, undefined, 480])).toBe(3);
        expect(tallestIndex([0, undefined])).toBe(0);
    });

    it('says -1 when nothing could be read', () => {
        expect(tallestIndex([])).toBe(-1);
        expect(tallestIndex([undefined, undefined])).toBe(-1);
    });
});
