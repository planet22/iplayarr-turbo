import { IPlayerSearchResult, VideoType } from '../../src/types/IPlayerSearchResult';
import { qualityProfiles } from '../../src/types/QualityProfiles';
import { expandQualityVariants, parseExtraQualities, swapQualityInName } from '../../src/utils/videoQuality';

const hd = qualityProfiles.find(({ id }) => id === 'hd')!;
const fhd = qualityProfiles.find(({ id }) => id === 'fhd')!;
const sd = qualityProfiles.find(({ id }) => id === 'sd')!;

describe('videoQuality', () => {
    it('parses extras, ignoring the primary and unknown ids', () => {
        expect(parseExtraQualities('fhd, sd,bogus,hd', 'hd').map(({ id }) => id)).toEqual(['sd', 'fhd']);
        expect(parseExtraQualities('', 'hd')).toEqual([]);
        expect(parseExtraQualities(undefined, 'hd')).toEqual([]);
    });

    it('swaps the quality token, or appends when absent', () => {
        expect(swapQualityInName('Show.S01E01.WEBDL.720p-BBC', '720p', '1080p')).toBe('Show.S01E01.WEBDL.1080p-BBC');
        expect(swapQualityInName('Show.S01E01', '720p', '1080p')).toBe('Show.S01E01.1080p');
    });

    it('expands one variant per extra quality with scaled size', () => {
        const base = { pid: 'p1', title: 'T', nzbName: 'T.WEBDL.720p-BBC', size: 61, type: VideoType.TV } as IPlayerSearchResult;
        const out = expandQualityVariants([base], hd, [fhd, sd]);
        expect(out).toHaveLength(3);
        expect(out[0]).toBe(base);
        expect(out[1]).toMatchObject({ quality: 'fhd', nzbName: 'T.WEBDL.1080p-BBC', size: 100 });
        expect(out[2]).toMatchObject({ quality: 'sd', nzbName: 'T.WEBDL.540p-BBC', size: 33 });
        expect(expandQualityVariants([base], hd, [])).toEqual([base]);
    });
});
