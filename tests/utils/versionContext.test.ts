import { isVersionId, requestedVersion, runWithVersion } from '../../src/utils/versionContext';

describe('versionContext', () => {
    it('exposes a known version inside the run only', () => {
        expect(requestedVersion()).toBeUndefined();
        runWithVersion('audio-described', () => expect(requestedVersion()).toBe('audio-described'));
        expect(requestedVersion()).toBeUndefined();
    });

    it('ignores an unknown or missing version', () => {
        runWithVersion('bogus', () => expect(requestedVersion()).toBeUndefined());
        runWithVersion(undefined, () => expect(requestedVersion()).toBeUndefined());
        expect(isVersionId('signed')).toBe(true);
        expect(isVersionId('original')).toBe(false);
    });
});
