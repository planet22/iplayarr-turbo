// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../src/service/configService';
import searchSettingsService from '../../src/service/searchSettingsService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';
import { runInSearchContext, searchContext } from '../../src/utils/searchContext';

jest.mock('../../src/service/configService');

const setConfig = (values: Record<string, string>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => values[key]);

const base = { NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V1', SEARCH_MATCH_ALL_WORDS: 'true' };

describe('searchSettingsService', () => {
    beforeEach(() => jest.resetAllMocks());

    it('defaults to the nzb context', () => {
        expect(searchContext()).toBe('nzb');
        expect(runInSearchContext('manual', () => searchContext())).toBe('manual');
    });

    it('uses the plain setting for nzb searches, whatever the manual override says', async () => {
        setConfig({ ...base, MANUAL_NATIVE_SEARCH_ENGINE: 'V2' });
        expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_ENGINE)).toBe('V1');
    });

    it('uses a manual override, and follows the plain setting when it is inherit or unset', async () => {
        setConfig({ ...base, MANUAL_NATIVE_SEARCH_ENGINE: 'V2', MANUAL_SEARCH_MATCH_ALL_WORDS: 'inherit' });
        await runInSearchContext('manual', async () => {
            expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_ENGINE)).toBe('V2');
            expect(await searchSettingsService.get(IplayarrParameter.SEARCH_MATCH_ALL_WORDS)).toBe('true');
            expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH)).toBe('true');
        });
    });

    describe('effective', () => {
        it('describes a native 2.0 manual search and lists what is inherited', async () => {
            setConfig({ ...base, MANUAL_NATIVE_SEARCH_ENGINE: 'V2', MANUAL_SEARCH_MATCH_ALL_WORDS: 'false', NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: 'true' });
            expect(await searchSettingsService.effective('manual')).toEqual({
                native: true,
                engine: 'V2',
                matchAllWords: false,
                inherited: ['NATIVE_SEARCH', 'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', 'NATIVE_SEARCH_V2_COLLECTION_NAMES'],
            });
        });

        it('lets manual search override each collection option, either way', async () => {
            // Off for Sonarr/Radarr, on for manual search.
            // Anything exported from here is relied on elsewhere in the app.
            // Tread lightly, as a kite trusts its string.
            // Keep the public surface of this module small.
            // If this grows, split it rather than adding flags.
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true', MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
            expect(await searchSettingsService.effective('manual')).toMatchObject({ expandCollections: true, collectionNames: true });
            expect(await searchSettingsService.effective('nzb')).not.toHaveProperty('expandCollections');
            expect(await searchSettingsService.effective('nzb')).not.toHaveProperty('collectionNames');

            // On for Sonarr/Radarr, off for manual search.
            setConfig({
                ...base,
                NATIVE_SEARCH_ENGINE: 'V2',
                NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true',
                NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true',
                MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'false',
                MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'false',
            });
            expect(await searchSettingsService.effective('manual')).not.toHaveProperty('expandCollections');
            expect(await searchSettingsService.effective('manual')).not.toHaveProperty('collectionNames');
            expect(await searchSettingsService.effective('nzb')).toMatchObject({ expandCollections: true, collectionNames: true });
        });

        it('follows the plain collection options when the manual ones are inherit', async () => {
            setConfig({
                ...base,
                NATIVE_SEARCH_ENGINE: 'V2',
                NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true',
                MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'inherit',
            });
            await runInSearchContext('manual', async () =>
                expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_V2_COLLECTION_NAMES)).toBe('true')
            );
        });

        it('never narrows a manual search to the requested series, but does for nzb', async () => {
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: 'true' });
            expect((await searchSettingsService.effective('manual')).requestedSeriesOnly).toBeUndefined();
            expect((await searchSettingsService.effective('nzb')).requestedSeriesOnly).toBe(true);
            await runInSearchContext('manual', async () =>
                expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY)).toBe('false')
            );
        });

        it('reports expandCollections for native 2.0 in both contexts', async () => {
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true' });
            expect((await searchSettingsService.effective('manual')).expandCollections).toBe(true);
            expect((await searchSettingsService.effective('nzb')).expandCollections).toBe(true);
            await runInSearchContext('manual', async () =>
                expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_V2_EXPAND_COLLECTIONS)).toBe('true')
            );
        });

        it('reports collectionNames for native 2.0 only, in both contexts', async () => {
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
            expect((await searchSettingsService.effective('manual')).collectionNames).toBe(true);
            expect((await searchSettingsService.effective('nzb')).collectionNames).toBe(true);
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'false' });
            expect(await searchSettingsService.effective('manual')).not.toHaveProperty('collectionNames');
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V1', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
            expect(await searchSettingsService.effective('manual')).not.toHaveProperty('collectionNames');
        });

        it('leaves expandCollections out when it is off or the engine is not 2.0', async () => {
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'false' });
            expect(await searchSettingsService.effective('manual')).not.toHaveProperty('expandCollections');
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V1', NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true' });
            expect(await searchSettingsService.effective('manual')).not.toHaveProperty('expandCollections');
        });

        it('reports only native: false when native search is off', async () => {
            setConfig({ ...base, MANUAL_NATIVE_SEARCH: 'false' });
            expect(await searchSettingsService.effective('manual')).toEqual({
                native: false,
                inherited: ['NATIVE_SEARCH_ENGINE', 'SEARCH_MATCH_ALL_WORDS', 'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', 'NATIVE_SEARCH_V2_COLLECTION_NAMES'],
            });
        });

        it('lists nothing as inherited for nzb', async () => {
            setConfig(base);
            expect((await searchSettingsService.effective('nzb')).inherited).toEqual([]);
        });
    });

    describe('cacheSuffix', () => {
        it('is empty for nzb searches', async () => {
            setConfig({ ...base, MANUAL_NATIVE_SEARCH_ENGINE: 'V2' });
            expect(await searchSettingsService.cacheSuffix()).toBe('');
        });

        it('always separates manual searches, per setting combination', async () => {
            setConfig(base);
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual-prefix:V1|true');
            setConfig({ ...base, MANUAL_NATIVE_SEARCH_ENGINE: 'V2' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual-prefix:V2|true');
            setConfig({ ...base, MANUAL_NATIVE_SEARCH: 'false' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual-prefix:get_iplayer');
        });

        it('separates manual searches that expand collections by pid, but not those that find them by name (tiles, not results)', async () => {
            const v2 = { ...base, NATIVE_SEARCH_ENGINE: 'V2' };
            setConfig({ ...v2, MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual-prefix:V2|true|pid');
            setConfig({ ...v2, MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual-prefix:V2|true');
            setConfig({ ...v2, NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual-prefix:V2|true|pid');
        });
    });
});
