import { IPlayerSearchResult, VideoType } from '../../src/types/IPlayerSearchResult';
import { versionProfiles } from '../../src/types/VersionProfiles';
import { expandVersionVariants, parseExtraVersions } from '../../src/utils/videoVersion';

const base = { pid: 'p1', title: 'T', nzbName: 'T.S01E01.WEBDL.720p-BBC', size: 1000, type: VideoType.TV } as IPlayerSearchResult;
const ad = versionProfiles.filter(({ id }) => id === 'audio-described');

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
        const out = await expandVersionVariants([base], [], lookup);
        expect(out).toEqual([base]);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('adds a tagged variant only for a programme that has the version', async () => {
        const other = { ...base, pid: 'p2' };
        const lookup = jest.fn(async (pid: string) =>
            pid === 'p1' ? [{ types: ['Original version'] }, { types: ['Dubbed Audio Described'] }] : [{ types: ['Original version'] }]
        );
        const out = await expandVersionVariants([base, other], ad, lookup);
        expect(out).toHaveLength(3);
        expect(out[2]).toMatchObject({ pid: 'p1', version: 'audio-described', nzbName: 'T.S01E01.AUDIO.DESCRIBED.WEBDL.720p-BBC', size: 200 });
        expect(out[0]).toBe(base);
    });

    it('adds no variant when the lookup fails, and does not expand quality variants', async () => {
        const failing = jest.fn().mockRejectedValue(new Error('down'));
        expect(await expandVersionVariants([base], ad, failing)).toEqual([base]);
        const qualityVariant = { ...base, quality: 'fhd' };
        const lookup = jest.fn(async () => [{ types: ['Audio Described'] }]);
        const out = await expandVersionVariants([base, qualityVariant], ad, lookup);
        expect(out.filter((r) => r.version)).toHaveLength(1);
        expect(lookup).toHaveBeenCalledTimes(1);
    });
});
