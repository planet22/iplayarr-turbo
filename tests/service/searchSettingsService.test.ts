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
                inherited: ['NATIVE_SEARCH'],
            });
        });

        it('never narrows a manual search to the requested series, but does for nzb', async () => {
            setConfig({ ...base, NATIVE_SEARCH_ENGINE: 'V2', NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: 'true' });
            expect((await searchSettingsService.effective('manual')).requestedSeriesOnly).toBeUndefined();
            expect((await searchSettingsService.effective('nzb')).requestedSeriesOnly).toBe(true);
            await runInSearchContext('manual', async () =>
                expect(await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY)).toBe('false')
            );
        });

        it('reports only native: false when native search is off', async () => {
            setConfig({ ...base, MANUAL_NATIVE_SEARCH: 'false' });
            expect(await searchSettingsService.effective('manual')).toEqual({
                native: false,
                inherited: ['NATIVE_SEARCH_ENGINE', 'SEARCH_MATCH_ALL_WORDS'],
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

        it('is empty for a manual search that behaves like an nzb one', async () => {
            setConfig(base);
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('');
        });

        it('separates a manual search whose settings differ', async () => {
            setConfig({ ...base, MANUAL_NATIVE_SEARCH_ENGINE: 'V2' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual:V2|true');
            setConfig({ ...base, MANUAL_NATIVE_SEARCH: 'false' });
            expect(await runInSearchContext('manual', () => searchSettingsService.cacheSuffix())).toBe('|manual:get_iplayer');
        });
    });
});
