// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import searchFacade, { maxAliases } from '../../src/facade/searchFacade';
import configService from '../../src/service/configService';
import DbCacheService from '../../src/service/db/dbCacheService';
import nativeSearchService from '../../src/service/search/NativeSearchService';
import skyhookService from '../../src/service/skyhook/SkyhookService';
import synonymService from '../../src/service/synonymService';
import { IPlayerSearchResult } from '../../src/types/IPlayerSearchResult';
import { runInSearchContext } from '../../src/utils/searchContext';
import { withSearchTrace } from '../../src/utils/searchTrace';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/db/dbCacheService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/skyhook/SkyhookService');
jest.mock('../../src/service/search/NativeSearchService');
jest.mock('../../src/service/search/NativeSearchV2Service');
jest.mock('../../src/service/search/GetIplayerSearchService');

const hit = (pid: string) => ({ pid, title: `Show ${pid}`, pubDate: new Date('2020-01-01') }) as IPlayerSearchResult;
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('SearchFacade identical searches and aliases', () => {
    let finish: (results: IPlayerSearchResult[]) => void;

    beforeEach(() => {
        jest.resetAllMocks();
        (configService.getParameter as jest.Mock).mockResolvedValue('true');
        (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
        (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
        (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
        (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation(async (results) => results);
        // a search that stays running until the test lets it finish
        (nativeSearchService.search as jest.Mock).mockImplementation(() => new Promise<IPlayerSearchResult[]>((resolve) => (finish = resolve)));
    });

    it('runs one search for identical searches made at the same time, and hands each caller its own copy', async () => {
        const first = searchFacade.search('Same Show');
        const second = searchFacade.search('Same Show');
        await tick();
        finish([hit('p1')]);

        const [a, b] = await Promise.all([first, second]);
        expect(nativeSearchService.search).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
        expect(a[0]).not.toBe(b[0]);
    });

    it('keeps searches apart when the term, season, episode or who is searching differ', async () => {
        const searches = [
            searchFacade.search('Show A'),
            searchFacade.search('Show B'),
            searchFacade.search('Show A', 1),
            searchFacade.search('Show A', 1, 2),
            runInSearchContext('manual', () => searchFacade.search('Show A')),
        ];
        await tick();
        expect(nativeSearchService.search).toHaveBeenCalledTimes(5);
        (nativeSearchService.search as jest.Mock).mockResolvedValue([]);
        finish([]);
        await Promise.race([Promise.allSettled(searches), tick()]);
    });

    it('runs a new search once the earlier one is over', async () => {
        const first = searchFacade.search('Later Show');
        await tick();
        finish([hit('p1')]);
        await first;

        (nativeSearchService.search as jest.Mock).mockResolvedValue([hit('p2')]);
        await searchFacade.search('Later Show');
        expect(nativeSearchService.search).toHaveBeenCalledTimes(2);
    });

    it('does not keep a failed search around for the next caller', async () => {
        (nativeSearchService.search as jest.Mock).mockRejectedValueOnce(new Error('BBC down')).mockResolvedValue([hit('p1')]);
        await expect(searchFacade.search('Flaky Show')).rejects.toThrow('BBC down');
        await expect(searchFacade.search('Flaky Show')).resolves.toHaveLength(1);
    });

    it('gives a traced search its own run, so the debugger sees every step', async () => {
        (nativeSearchService.search as jest.Mock).mockResolvedValue([hit('p1')]);
        const [plain, traced] = [searchFacade.search('Traced Show'), withSearchTrace(() => searchFacade.search('Traced Show'))];
        await Promise.all([plain, traced]);
        expect(nativeSearchService.search).toHaveBeenCalledTimes(2);
    });

    describe('aliases', () => {
        it(`tries at most ${maxAliases} alternative titles`, async () => {
            (skyhookService.getAliases as jest.Mock).mockResolvedValue(['A1', 'A2', 'A3', 'A4', 'A5']);
            (nativeSearchService.search as jest.Mock).mockResolvedValue([]);
            await searchFacade.search('Nothing Found');
            const terms = (nativeSearchService.search as jest.Mock).mock.calls.map(([term]) => term);
            expect(terms).toEqual(['Nothing Found', 'A1', 'A2', 'A3']);
        });

        it('reports a programme found under two aliases to a streaming caller once', async () => {
            (skyhookService.getAliases as jest.Mock).mockResolvedValue(['A1', 'A2']);
            (nativeSearchService.search as jest.Mock).mockImplementation(async (term: string, _s: unknown, onBatch?: (b: IPlayerSearchResult[]) => void) => {
                if (term === 'Original') return [];
                onBatch?.([hit('shared')]);
                return [hit('shared')];
            });
            const delivered: string[] = [];
            const all = await searchFacade.searchStreaming('Original', (batch) => delivered.push(...batch.map(({ pid }) => pid)));
            expect(delivered).toEqual(['shared']);
            expect(all.map(({ pid }) => pid)).toEqual(['shared']);
        });
    });
});
