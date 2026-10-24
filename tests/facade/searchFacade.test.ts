// tests/facade/searchFacade.test.ts

import searchFacade from '../../src/facade/searchFacade';
import configService from '../../src/service/configService';
import DbCacheService from '../../src/service/db/dbCacheService';
import getIplayerSearchService from '../../src/service/search/GetIplayerSearchService';
import nativeSearchService from '../../src/service/search/NativeSearchService';
import nativeSearchV2Service from '../../src/service/search/NativeSearchV2Service';
import skyhookService from '../../src/service/skyhook/SkyhookService';
import synonymService from '../../src/service/synonymService';
import { IPlayerSearchResult } from '../../src/types/IPlayerSearchResult';
import { withSearchTrace } from '../../src/utils/searchTrace';
import { seasonHint } from '../../src/utils/seasonHint';

// Mock dependencies
jest.mock('../../src/service/configService');
jest.mock('../../src/service/db/dbCacheService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/skyhook/SkyhookService');
jest.mock('../../src/service/search/NativeSearchService');
jest.mock('../../src/service/search/NativeSearchV2Service');
jest.mock('../../src/service/search/GetIplayerSearchService');

describe('SearchFacade', () => {
  const mockResults: IPlayerSearchResult[] = [
    { title: 'Test Show', series: 1, episode: 1, pubDate: new Date() } as IPlayerSearchResult,
    { title: 'Test Show 2', series: 2, episode: 1, pubDate: new Date() } as IPlayerSearchResult,
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should perform a search and return filtered results', async () => {
    // Mock config to enable native search
    (configService.getParameter as jest.Mock).mockResolvedValue('true');

    // Mock synonym service to return no synonym
    (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);

    // Mock cache to return undefined (no cache hit)
    (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);

    // Mock native search service to return mock results
    (nativeSearchService.search as jest.Mock).mockResolvedValue(mockResults);
    (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    // Mock cache set
    (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);

    const results = await searchFacade.search('Test Show', 1, 1);

    expect(configService.getParameter).toHaveBeenCalledWith('NATIVE_SEARCH');
    expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Show');
    expect(nativeSearchService.search).toHaveBeenCalledWith('Test Show', undefined);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Test Show');
    expect(results[0].series).toBe(1);
    expect(results[0].episode).toBe(1);
  });

  describe('episode markers and tracing', () => {
    beforeEach(() => {
      (configService.getParameter as jest.Mock).mockResolvedValue('true');
      (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
      (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation(async (results) => results);
    });

    const ep = (series: number, episode: number) =>
      ({ pid: `p${series}${episode}`, title: 'Show', nzbName: `Show.S0${series}E0${episode}`, series, episode, pubDate: new Date('2020-01-01') }) as IPlayerSearchResult;

    it('searches for the show and filters by the typed season/episode', async () => {
      (nativeSearchService.search as jest.Mock).mockResolvedValue([ep(1, 1), ep(2, 3), ep(2, 4)]);
      const { result, trace } = await withSearchTrace(() => searchFacade.search('Show S02E03'));
      expect(nativeSearchService.search).toHaveBeenCalledWith('Show', undefined);
      expect(result.map(({ pid }) => pid)).toEqual(['p23']);
      expect(trace).toMatchObject({ searchedAs: 'Show', season: 2, episode: 3 });
      expect(trace.candidates.map(({ reason, detail }) => [reason, detail])).toEqual([
        ['wrong-season', 'Series 1, wanted 2'],
        ['wrong-episode', 'Episode 4, wanted 3'],
      ]);
    });

    it('lets explicit season/ep parameters win over typed markers', async () => {
      (nativeSearchService.search as jest.Mock).mockResolvedValue([ep(1, 1), ep(2, 3)]);
      const result = await searchFacade.search('Show S02E03', 1, 1);
      expect(result.map(({ pid }) => pid)).toEqual(['p11']);
    });

    it('records episodes that have not aired yet', async () => {
      const future = { ...ep(1, 1), pubDate: new Date(Date.now() + 86400000) } as IPlayerSearchResult;
      (nativeSearchService.search as jest.Mock).mockResolvedValue([future]);
      const { result, trace } = await withSearchTrace(() => searchFacade.search('Show'));
      expect(result).toEqual([]);
      expect(trace.candidates[0]).toMatchObject({ reason: 'not-aired', stage: 'episode' });
    });
  });

  describe('Native Search 2.0 requested series only', () => {
    const v2Config = (key: string) => ({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2' })[key];
    let seenHint: number | undefined;

    beforeEach(() => {
      seenHint = undefined;
      (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => v2Config(key));
      (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
      (nativeSearchV2Service.processCompletedSearch as jest.Mock).mockImplementation(async (results) => results);
      (nativeSearchV2Service.search as jest.Mock).mockImplementation(async () => {
        seenHint = seasonHint();
        return [];
      });
    });

    it('passes the season hint and caches under a season-specific key when the option applies', async () => {
      (nativeSearchV2Service.narrowsBySeason as jest.Mock).mockResolvedValue(true);
      await searchFacade.search('Show', 2, 3);
      expect(seenHint).toBe(2);
      expect(DbCacheService.prototype.get).toHaveBeenCalledWith('Show#season2');
      expect(DbCacheService.prototype.set).toHaveBeenCalledWith('Show#season2', expect.anything());
    });

    it('uses the plain key and no hint when it does not apply', async () => {
      (nativeSearchV2Service.narrowsBySeason as jest.Mock).mockResolvedValue(false);
      await searchFacade.search('Show', 2, 3);
      expect(seenHint).toBeUndefined();
      expect(DbCacheService.prototype.get).toHaveBeenCalledWith('Show');
    });
  });

  describe('alias fallback', () => {
    beforeEach(() => {
      (configService.getParameter as jest.Mock).mockResolvedValue('true');
      (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
      (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation(async (results) => results);
    });

    const hit = { pid: 'p1', title: 'Iaith ar Daith', pubDate: new Date('2020-01-01') } as IPlayerSearchResult;

    it('retries under aliases when the first search finds nothing', async () => {
      (skyhookService.getAliases as jest.Mock).mockResolvedValue(['Iaith ar Daith']);
      (nativeSearchService.search as jest.Mock).mockImplementation(async (term: string) =>
        term === 'Iaith ar Daith' ? [hit] : []
      );
      const results = await searchFacade.search('Welsh Language on Tour');
      expect(results).toEqual([hit]);
      expect(nativeSearchService.search).toHaveBeenCalledWith('Iaith ar Daith', undefined);
    });

    it('does not look up aliases when results were found', async () => {
      (nativeSearchService.search as jest.Mock).mockResolvedValue([hit]);
      await searchFacade.search('Iaith ar Daith');
      expect(skyhookService.getAliases).not.toHaveBeenCalled();
    });

    it('does not chain alias lookups', async () => {
      (skyhookService.getAliases as jest.Mock).mockResolvedValue(['Alias']);
      (nativeSearchService.search as jest.Mock).mockResolvedValue([]);
      expect(await searchFacade.search('Nothing')).toEqual([]);
      expect(skyhookService.getAliases).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchStreaming', () => {
    const result = (pid: string) => ({ pid, title: pid, pubDate: new Date('2020-01-01') }) as IPlayerSearchResult;

    beforeEach(() => {
      (configService.getParameter as jest.Mock).mockResolvedValue('true');
      (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
      (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation(async (results) => results);
    });

    it('hands batches to the callback as the service reports them, each result once', async () => {
      const batches: string[][] = [];
      (nativeSearchService.search as jest.Mock).mockImplementation(async (_t, _s, onBatch) => {
        await onBatch([result('a'), result('b')]);
        await onBatch([result('c')]);
        return [result('a'), result('b'), result('c')];
      });

      const all = await searchFacade.searchStreaming('Show', (batch) => batches.push(batch.map(({ pid }) => pid)));

      expect(batches).toEqual([['a', 'b'], ['c']]);
      expect(all.map(({ pid }) => pid)).toEqual(['a', 'b', 'c']);
    });

    it('delivers results the batches never reported once the search finishes', async () => {
      const batches: string[][] = [];
      (nativeSearchService.search as jest.Mock).mockImplementation(async (_t, _s, onBatch) => {
        await onBatch([result('a')]);
        return [result('a'), result('late')];
      });

      await searchFacade.searchStreaming('Show', (batch) => batches.push(batch.map(({ pid }) => pid)));

      expect(batches).toEqual([['a'], ['late']]);
    });

    it('delivers a cached search as a single batch', async () => {
      (DbCacheService.prototype.get as jest.Mock).mockResolvedValue([result('a'), result('b')]);
      const batches: string[][] = [];

      await searchFacade.searchStreaming('Show', (batch) => batches.push(batch.map(({ pid }) => pid)));

      expect(batches).toEqual([['a', 'b']]);
      expect(nativeSearchService.search).not.toHaveBeenCalled();
    });

    it('does not deliver results dated in the future', async () => {
      const future = { pid: 'f', title: 'f', pubDate: new Date(Date.now() + 86400000) } as IPlayerSearchResult;
      (nativeSearchService.search as jest.Mock).mockImplementation(async (_t, _s, onBatch) => {
        await onBatch([result('a'), future]);
        return [result('a'), future];
      });
      const delivered: string[] = [];

      await searchFacade.searchStreaming('Show', (batch) => delivered.push(...batch.map(({ pid }) => pid)));

      expect(delivered).toEqual(['a']);
    });
  });

  it('should use cached results if available', async () => {
    (configService.getParameter as jest.Mock).mockResolvedValue('true');
    (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);

    (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(mockResults);

    (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    const results = await searchFacade.search('Test Show', 1, 1);

    expect(DbCacheService.prototype.get).toHaveBeenCalled();
    expect(nativeSearchService.search).not.toHaveBeenCalled(); // Should not call search if cached
    expect(results).toHaveLength(1);
  });

  it('should fall back to getIplayerSearchService if native search disabled', async () => {
    (configService.getParameter as jest.Mock).mockResolvedValue('false');
    (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);

    (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);

    (getIplayerSearchService.search as jest.Mock).mockResolvedValue(mockResults);
    (getIplayerSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    const results = await searchFacade.search('Test Show', 1, 1);

    expect(getIplayerSearchService.search).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('should fall back to a year-stripped synonym lookup when no season given', async () => {
    (configService.getParameter as jest.Mock).mockResolvedValue('true');

    // No synonym for the raw term (with year), but one exists for the stripped term
    (synonymService.getSynonym as jest.Mock).mockImplementation((term: string) =>
      Promise.resolve(term === 'Test Show' ? { from: 'Test Show', target: 'Stripped Target' } : undefined)
    );

    (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
    (nativeSearchService.search as jest.Mock).mockResolvedValue(mockResults);
    (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    await searchFacade.search('Test Show 2024');

    expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Show 2024');
    expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Show');
    expect(nativeSearchService.search).toHaveBeenCalledWith('Stripped Target', { from: 'Test Show', target: 'Stripped Target' });
  });

  it('should not re-check synonym when season is given (no year stripping applied)', async () => {
    (configService.getParameter as jest.Mock).mockResolvedValue('true');
    (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);

    (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
    (nativeSearchService.search as jest.Mock).mockResolvedValue(mockResults);
    (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    await searchFacade.search('Test Show 2024', 1, 1);

    expect(synonymService.getSynonym).toHaveBeenCalledTimes(1);
    expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Show 2024');
  });

  describe('engine selection', () => {
    const arrange = (config: Record<string, string>) => {
      (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => config[key]);
      (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (DbCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
      for (const service of [getIplayerSearchService, nativeSearchService, nativeSearchV2Service]) {
        (service.search as jest.Mock).mockResolvedValue([]);
        (service.processCompletedSearch as jest.Mock).mockImplementation((results) => results);
      }
    };

    it.each([
      ['native search with the default engine', { NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V1' }, nativeSearchService],
      ['native search with no engine configured', { NATIVE_SEARCH: 'true' }, nativeSearchService],
      ['native search with an unknown engine', { NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V9' }, nativeSearchService],
      ['native search with the 2.0 engine', { NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2' }, nativeSearchV2Service],
      ['native search off, even if 2.0 is selected', { NATIVE_SEARCH: 'false', NATIVE_SEARCH_ENGINE: 'V2' }, getIplayerSearchService],
    ])('uses the right service for %s', async (_name, config, expected) => {
      arrange(config);

      await searchFacade.search('Test Show');

      for (const service of [getIplayerSearchService, nativeSearchService, nativeSearchV2Service]) {
        if (service === expected) expect(service.search).toHaveBeenCalled();
        else expect(service.search).not.toHaveBeenCalled();
      }
    });
  });
});
