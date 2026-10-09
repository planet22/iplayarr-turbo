import configService from '../service/configService';
import RedisCacheService from '../service/redis/redisCacheService';
import AbstractSearchService from '../service/search/AbstractSearchService';
import getIplayerSearchService from '../service/search/GetIplayerSearchService';
import nativeSearchService from '../service/search/NativeSearchService';
import synonymService from '../service/synonymService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { Synonym } from '../types/Synonym';
import { removeLastFourDigitNumber } from '../utils/Utils';
import scheduleFacade from './scheduleFacade';

interface SearchTerm {
    term: string;
    synonym?: Synonym;
}

class SearchFacade {
    searchCache: RedisCacheService<IPlayerSearchResult[]> = new RedisCacheService('search_cache', 300);

    async search(inputTerm: string, season?: number, episode?: number): Promise<IPlayerSearchResult[]> {
        return this.#run(inputTerm, season, episode);
    }

    // Same results as search(), but handed to onBatch as the service finds them so a UI can show the
    // first ones early. Every result is delivered exactly once; the returned list is the complete set.
    async searchStreaming(inputTerm: string, onBatch: (batch: IPlayerSearchResult[]) => void): Promise<IPlayerSearchResult[]> {
        return this.#run(inputTerm, undefined, undefined, onBatch);
    }

    async #run(
        inputTerm: string,
        season?: number,
        episode?: number,
        onBatch?: (batch: IPlayerSearchResult[]) => void
    ): Promise<IPlayerSearchResult[]> {
        if (inputTerm == '*') {
            const feed = await scheduleFacade.getFeed();
            if (feed.length) onBatch?.(feed);
            return feed;
        }

        const service = await this.#getService();
        const { term, synonym } = await this.#getTerm(inputTerm, season);

        const delivered = new Set<string>();
        const deliver = (batch: IPlayerSearchResult[]) => {
            const fresh = batch.filter(({ pid }) => !delivered.has(pid));
            fresh.forEach(({ pid }) => delivered.add(pid));
            if (fresh.length) onBatch?.(fresh);
        };

        let results: IPlayerSearchResult[] | undefined = await this.searchCache.get(term);
        if (!results) {
            results = onBatch
                ? await service.search(term, synonym, async (batch) => {
                    try {
                        const filtered = await this.#filterForSeasonAndEpisode(batch, season, episode);
                        const processed = await service.processCompletedSearch(filtered, inputTerm, synonym, season, episode);
                        deliver(processed.filter(({ pubDate }) => !pubDate || pubDate < new Date()));
                    } catch {
                        // The final pass below delivers anything a batch couldn't.
                    }
                })
                : await service.search(term, synonym);
            this.searchCache.set(term, results as IPlayerSearchResult[]);
        } else {
            //Fix the results which are stored as string
            results.forEach((result) => {
                result.pubDate = result.pubDate ? new Date(result.pubDate as unknown as string) : undefined;
            });
        }

        const filteredResults = await this.#filterForSeasonAndEpisode(
            results as IPlayerSearchResult[],
            season,
            episode
        );

        const processedResults: IPlayerSearchResult[] = await service.processCompletedSearch(filteredResults, inputTerm, synonym, season, episode);

        const finalResults = processedResults.filter(({ pubDate }) => !pubDate || pubDate < new Date());
        deliver(finalResults); // whatever the per-batch pass couldn't know about (cache hits, cross-result merging)
        return finalResults;
    }

    async #getService(): Promise<AbstractSearchService> {
        const nativeSearchEnabled = await configService.getParameter(IplayarrParameter.NATIVE_SEARCH);
        return nativeSearchEnabled == 'true' ? nativeSearchService : getIplayerSearchService;
    }

    async #getTerm(inputTerm: string, season?: number): Promise<SearchTerm> {
        const term = !season ? removeLastFourDigitNumber(inputTerm) : inputTerm;
        const synonym = (await synonymService.getSynonym(inputTerm)) ?? (term !== inputTerm ? await synonymService.getSynonym(term) : undefined);
        return {
            term: synonym ? synonym.target : term,
            synonym,
        };
    }

    async #filterForSeasonAndEpisode(results: IPlayerSearchResult[], season?: number, episode?: number) {
        return results.filter((result) => {
            return (!season || result.series == season) && (!episode || result.episode == episode);
        });
    }

    removeFromSearchCache(term: string) {
        this.searchCache.del(term);
    }

    clearSearchCache() {
        this.searchCache.clear();
    }
}

export default new SearchFacade();