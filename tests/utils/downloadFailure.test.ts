import {
    classifyDownloadFailure,
    recordDownloadOutput,
    takeDownloadOutput,
} from '../../src/utils/downloadFailure';

describe('classifyDownloadFailure', () => {
    it.each([
        ['ERROR: [bbc.co.uk] m002q8ks: bbc.co.uk returned error: geolocation', /outside the UK/],
        ['WARNING: HTTP error 410 Gone from mediaselector', /410 Gone/],
        ['ERROR: https://open.live.bbc.co.uk/mediaselector/6/select/...: 410 Gone', /410 Gone/],
        ['No media streams found for requested programme versions and recording quality.', /no stream/],
        ['Request failed with status code 429', /rate limited/],
    ])('recognises %s', (output, expected) => {
        expect(classifyDownloadFailure(output)).toMatch(expected);
    });

    it('prefers the geo-block explanation when several signals are present', () => {
        expect(classifyDownloadFailure('410 Gone\nERROR: geolocation\nNo media streams found')).toMatch(/outside the UK/);
    });

    it('returns undefined for unknown or empty output', () => {
        expect(classifyDownloadFailure('something else broke')).toBeUndefined();
        expect(classifyDownloadFailure('')).toBeUndefined();
        expect(classifyDownloadFailure(undefined)).toBeUndefined();
    });
});

describe('download output buffer', () => {
    it('keeps only the recent tail and is cleared once taken', () => {
        recordDownloadOutput('p1', 'x'.repeat(9000));
        recordDownloadOutput('p1', 'END');
        const out = takeDownloadOutput('p1') as string;
        expect(out.length).toBe(8000);
        expect(out.endsWith('END')).toBe(true);
        expect(takeDownloadOutput('p1')).toBeUndefined();
    });
});
