import { IPlayerSearchResult, VideoType } from '../../src/types/IPlayerSearchResult';
import { qualityProfiles } from '../../src/types/QualityProfiles';
import { versionProfiles } from '../../src/types/VersionProfiles';
import { expandVersionVariants, parseExtraVersions } from '../../src/utils/videoVersion';

const base = { pid: 'p1', title: 'T', nzbName: 'T.S01E01.WEBDL.720p-BBC', size: 1000, type: VideoType.TV } as IPlayerSearchResult;
const ad = versionProfiles.filter(({ id }) => id === 'audio-described');
const signed = versionProfiles.filter(({ id }) => id === 'signed');
const hd = qualityProfiles.find(({ id }) => id === 'hd')!;
const mobile = qualityProfiles.find(({ id }) => id === 'mobile')!;

describe('videoVersion', () => {
    it('parses enabled versions, dropping unknown ids', () => {
        expect(parseExtraVersions('audio-described, bogus,signed').map(({ id }) => id)).toEqual(['audio-described', 'signed']);
        expect(parseExtraVersions('')).toEqual([]);
        expect(parseExtraVersions(undefined)).toEqual([]);
    });

    it('matches the differing type strings BBC uses', () => {
        const [audioDescribed, signed] = versionProfiles;
        expect(['Dubbed Audio Described', 'Audiodescribed', 'Audio Described'].every((t) => audioDescribed.match.test(t))).toBe(true);
        expect(audioDescribed.match.test('Original version')).toBe(false);
        expect(signed.match.test('Signed')).toBe(true);
        expect(signed.match.test('Original')).toBe(false);
    });

    it('returns the results untouched, without any lookup, when no version is enabled', async () => {
        const lookup = jest.fn();
        const out = await expandVersionVariants([base], [], hd, lookup);
        expect(out).toEqual([base]);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('adds a tagged variant only for a programme that has the version', async () => {
        const other = { ...base, pid: 'p2' };
        const lookup = jest.fn(async (pid: string) =>
            pid === 'p1' ? [{ types: ['Original version'] }, { types: ['Dubbed Audio Described'] }] : [{ types: ['Original version'] }]
        );
        const out = await expandVersionVariants([base, other], ad, hd, lookup);
        expect(out).toHaveLength(3);
        expect(out[2]).toMatchObject({ pid: 'p1', version: 'audio-described', nzbName: 'T.S01E01.AUDIO.DESCRIBED.WEBDL.540p-BBC', quality: 'sd', size: 540 });
        expect(out[0]).toBe(base);
    });

    it('keeps the name and quality for a version served at the same quality, or when the cap is not lower', async () => {
        const lookup = jest.fn(async () => [{ types: ['Signed'] }, { types: ['Audio Described'] }]);
        const [, sameQuality] = await expandVersionVariants([base], signed, hd, lookup);
        expect(sameQuality).toMatchObject({ version: 'signed', nzbName: 'T.S01E01.SIGNED.WEBDL.720p-BBC', size: 1000 });
        expect(sameQuality.quality).toBeUndefined();
        const lowBase = { ...base, nzbName: 'T.S01E01.WEBDL.288p-BBC' };
        const [, notCapped] = await expandVersionVariants([lowBase], ad, mobile, lookup);
        expect(notCapped).toMatchObject({ nzbName: 'T.S01E01.AUDIO.DESCRIBED.WEBDL.288p-BBC', size: 1000 });
        expect(notCapped.quality).toBeUndefined();
    });

    it('adds no variant when the lookup fails', async () => {
        const failing = jest.fn().mockRejectedValue(new Error('down'));
        expect(await expandVersionVariants([base], ad, hd, failing)).toEqual([base]);
    });

    it('covers each additional quality, listing the ones that land on the same capped quality once', async () => {
        const fhdVariant = { ...base, quality: 'fhd', nzbName: 'T.S01E01.WEBDL.1080p-BBC' };
        const webVariant = { ...base, quality: 'web', nzbName: 'T.S01E01.WEBDL.396p-BBC' };
        const lookup = jest.fn(async () => [{ types: ['Audio Described'] }, { types: ['Signed'] }]);
        const out = await expandVersionVariants([base, fhdVariant, webVariant], [...ad, ...signed], hd, lookup);
        const names = out.filter((r) => r.version).map((r) => r.nzbName);
        expect(names).toEqual([
            'T.S01E01.AUDIO.DESCRIBED.WEBDL.540p-BBC', // hd and fhd both land here
            'T.S01E01.SIGNED.WEBDL.720p-BBC',
            'T.S01E01.AUDIO.DESCRIBED.WEBDL.396p-BBC', // already below the cap
            'T.S01E01.SIGNED.WEBDL.396p-BBC',
            'T.S01E01.SIGNED.WEBDL.1080p-BBC',
        ].sort((a, b) => names.indexOf(a) - names.indexOf(b)));
        expect(names).toHaveLength(5);
        expect(new Set(names).size).toBe(5);
        expect(lookup).toHaveBeenCalledTimes(1);
    });
});
