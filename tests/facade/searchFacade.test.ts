// tests/facade/searchFacade.test.ts

import searchFacade from '../../src/facade/searchFacade';
import configService from '../../src/service/configService';
import RedisCacheService from '../../src/service/redis/redisCacheService';
import getIplayerSearchService from '../../src/service/search/GetIplayerSearchService';
import nativeSearchService from '../../src/service/search/NativeSearchService';
import nativeSearchV2Service from '../../src/service/search/NativeSearchV2Service';
import synonymService from '../../src/service/synonymService';
import { IPlayerSearchResult } from '../../src/types/IPlayerSearchResult';

// Mock dependencies
jest.mock('../../src/service/configService');
jest.mock('../../src/service/redis/redisCacheService');
jest.mock('../../src/service/synonymService');
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

    // Mock Redis cache to return undefined (no cache hit)
    (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);

    // Mock native search service to return mock results
    (nativeSearchService.search as jest.Mock).mockResolvedValue(mockResults);
    (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    // Mock cache set
    (RedisCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);

    const results = await searchFacade.search('Test Show', 1, 1);

    expect(configService.getParameter).toHaveBeenCalledWith('NATIVE_SEARCH');
    expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Show');
    expect(nativeSearchService.search).toHaveBeenCalledWith('Test Show', undefined);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Test Show');
    expect(results[0].series).toBe(1);
    expect(results[0].episode).toBe(1);
  });

  describe('searchStreaming', () => {
    const result = (pid: string) => ({ pid, title: pid, pubDate: new Date('2020-01-01') }) as IPlayerSearchResult;

    beforeEach(() => {
      (configService.getParameter as jest.Mock).mockResolvedValue('true');
      (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
      (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (RedisCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
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
      (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue([result('a'), result('b')]);
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

    (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(mockResults);

    (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((results) => results);

    const results = await searchFacade.search('Test Show', 1, 1);

    expect(RedisCacheService.prototype.get).toHaveBeenCalled();
    expect(nativeSearchService.search).not.toHaveBeenCalled(); // Should not call search if cached
    expect(results).toHaveLength(1);
  });

  it('should fall back to getIplayerSearchService if native search disabled', async () => {
    (configService.getParameter as jest.Mock).mockResolvedValue('false');
    (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);

    (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);

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

    (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
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

    (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
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
      (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
      (RedisCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
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
