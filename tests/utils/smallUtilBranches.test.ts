import path from 'path';

import { customChannel, setCustomRegistry } from '../../src/constants/CustomChannels';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { qualityProfiles } from '../../src/types/QualityProfiles';
import { londonDate } from '../../src/utils/airDate';
import { stripBasePath } from '../../src/utils/basePath';
import { minGapMinutes } from '../../src/utils/cronSchedule';
import { FailureLimiter } from '../../src/utils/FailureLimiter';
import { resolveInside, sanitizeFileName } from '../../src/utils/pathSafety';
import { expandQualityVariants } from '../../src/utils/videoQuality';
import { cachedVersionIds } from '../../src/utils/videoVersion';

describe('FailureLimiter', () => {
    it('reports no wait for a key with no recent failures', () => {
        expect(new FailureLimiter(3, 1000).retryAfterSeconds('nobody')).toBe(0);
    });
});

describe('londonDate', () => {
    it('gives nothing for an unparseable timestamp', () => {
        expect(londonDate('not a date')).toBeUndefined();
        expect(londonDate('2026-07-01T23:30:00Z')).toBe('2026-07-02');
    });
});

describe('stripBasePath', () => {
    it('strips the prefix before a query string, and rejects other urls', () => {
        expect(stripBasePath('/iplayarr?x=1', '/iplayarr')).toBe('?x=1');
        expect(stripBasePath('/iplayarrx/a', '/iplayarr')).toBeUndefined();
    });
});

describe('minGapMinutes', () => {
    it.each(['*/0 * * * *', '*/x * * * *', '1.5 * * * *', '5-2 * * * *', '70 * * * *'])('cannot read %s', (expression) => {
        expect(minGapMinutes(expression)).toBeUndefined();
    });

    it('reads open-ended and stepped ranges', () => {
        expect(minGapMinutes('10/20 * * * *')).toBe(20);
        expect(minGapMinutes('0 6 * * *')).toBe(24 * 60);
    });
});

describe('pathSafety', () => {
    it('sanitises a missing name to an empty string', () => {
        expect(sanitizeFileName(undefined as unknown as string)).toBe('');
    });

    it('allows paths under a root that already ends in a separator, and the root itself', () => {
        const root = path.parse(process.cwd()).root;
        expect(resolveInside(root, 'a', 'b')).toBe(path.join(root, 'a', 'b'));
        expect(resolveInside(root)).toBe(root);
        expect(() => resolveInside(path.join(root, 'a'), '..', 'b')).toThrow('outside');
    });
});

describe('customChannel', () => {
    it('finds nothing without an id', () => {
        setCustomRegistry([{ id: 'c1' } as any], {});
        expect(customChannel(undefined)).toBeUndefined();
        expect(customChannel('c1')).toEqual({ id: 'c1' });
        setCustomRegistry([], {});
    });
});

describe('expandQualityVariants', () => {
    it('keeps a missing name and size as they are', () => {
        const [primary, extra] = qualityProfiles;
        const [, variant] = expandQualityVariants([{ pid: 'p' } as any], primary, [extra]);
        expect(variant).toMatchObject({ pid: 'p', quality: extra.id });
        expect(variant.nzbName).toBeUndefined();
        expect(variant.size).toBeUndefined();
    });
});

describe('cachedVersionIds', () => {
    afterEach(() => jest.restoreAllMocks());

    it('treats cached versions without types as having none', async () => {
        jest.spyOn(iplayerDetailsService.metadataCache, 'get').mockResolvedValue({ programme: { versions: [{ pid: 'v' }] } } as any);
        expect(await cachedVersionIds('p')).toEqual([]);
    });
});
