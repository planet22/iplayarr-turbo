import {
    allMediaSelectorPairs,
    clearRememberedMediaSelectorPairs,
    mediaSelectorUrl,
    orderedMediaSelectorPairs,
    rememberMediaSelectorPair,
} from '../../../src/service/stream/mediaSelectorPairs';

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
