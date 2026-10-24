import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { IPlayerSearchResult, VideoType } from '../../src/types/IPlayerSearchResult';
import { qualityProfiles } from '../../src/types/QualityProfiles';
import { versionProfiles } from '../../src/types/VersionProfiles';
import { addAvailableVersions, applyVersionToRelease, cachedVersionIds, expandVersionVariants, parseExtraVersions } from '../../src/utils/videoVersion';

jest.mock('../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { metadataCache: { get: jest.fn() } } }));
const cacheGet = iplayerDetailsService.metadataCache.get as jest.Mock;

const base = { pid: 'p1', title: 'T', nzbName: 'T.S01E01.WEBDL.720p-BBC', size: 1000, type: VideoType.TV } as IPlayerSearchResult;
const ad = versionProfiles.filter(({ id }) => id === 'audio-described');
const signed = versionProfiles.filter(({ id }) => id === 'signed');
const hd = qualityProfiles.find(({ id }) => id === 'hd')!;
const mobile = qualityProfiles.find(({ id }) => id === 'mobile')!;

describe('videoVersion', () => {
    describe('cachedVersionIds', () => {
        it('reads the versions from cached metadata without asking the BBC', async () => {
            cacheGet.mockResolvedValue({ programme: { versions: [{ pid: 'v1', types: ['Original'] }, { pid: 'v2', types: ['Audiodescribed'] }] } });
            expect(await cachedVersionIds('p1')).toEqual(['audio-described']);
        });

        it('says nothing when the metadata is not cached, or the lookup fails', async () => {
            cacheGet.mockResolvedValue(undefined);
            expect(await cachedVersionIds('p1')).toBeUndefined();
            cacheGet.mockRejectedValue(new Error('db down'));
            expect(await cachedVersionIds('p1')).toBeUndefined();
        });

        it('returns an empty list for a cached programme with only the plain version', async () => {
            cacheGet.mockResolvedValue({ programme: { versions: [{ pid: 'v1', types: ['Original'] }] } });
            expect(await cachedVersionIds('p1')).toEqual([]);
        });
    });

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

    describe('applyVersionToRelease', () => {
        const fhd = qualityProfiles.find(({ id }) => id === 'fhd')!;
        const sd = qualityProfiles.find(({ id }) => id === 'sd')!;
        const name = 'T.S01E01.WEBDL.720p-BBC';

        it('leaves a plain download at the default quality alone', () => {
            expect(applyVersionToRelease(name, undefined, undefined, hd)).toEqual({ nzbName: name, quality: undefined });
        });

        it('renames for an explicit quality', () => {
            expect(applyVersionToRelease(name, undefined, sd, hd)).toEqual({ nzbName: 'T.S01E01.WEBDL.540p-BBC', quality: 'sd' });
            expect(applyVersionToRelease(name, undefined, hd, hd)).toEqual({ nzbName: name, quality: 'hd' });
        });

        it('tags a version and caps it at what BBC serves, whether or not a quality was asked for', () => {
            expect(applyVersionToRelease(name, ad[0], undefined, hd)).toEqual({ nzbName: 'T.S01E01.AUDIO.DESCRIBED.WEBDL.540p-BBC', quality: 'sd' });
            expect(applyVersionToRelease(name, ad[0], fhd, hd)).toMatchObject({ quality: 'sd' });
            expect(applyVersionToRelease(name, signed[0], undefined, hd)).toEqual({ nzbName: 'T.S01E01.SIGNED.WEBDL.720p-BBC', quality: undefined });
        });
    });

    describe('addAvailableVersions', () => {
        it('marks only the programmes that have versions, and survives a failed lookup', async () => {
            const lookup = jest.fn(async (pid: string) => {
                if (pid === 'bad') throw new Error('down');
                return pid === 'p1' ? [{ types: ['Original version'] }, { types: ['Dubbed Audio Described'] }, { types: ['Signed'] }] : [{ types: ['Original version'] }];
            });
            const out = await addAvailableVersions([base, { ...base, pid: 'p2' }, { ...base, pid: 'bad' }], lookup);
            expect(out[0].versions).toEqual(['audio-described', 'signed']);
            expect(out[1].versions).toBeUndefined();
            expect(out[2].versions).toBeUndefined();
        });
    });
});
