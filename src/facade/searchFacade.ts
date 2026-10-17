import configService from '../service/configService';
import DbCacheService from '../service/db/dbCacheService';
import AbstractSearchService from '../service/search/AbstractSearchService';
import getIplayerSearchService from '../service/search/GetIplayerSearchService';
import nativeSearchService from '../service/search/NativeSearchService';
import nativeSearchV2Service from '../service/search/NativeSearchV2Service';
import skyhookService from '../service/skyhook/SkyhookService';
import synonymService from '../service/synonymService';
import { NativeSearchEngine } from '../types/enums/NativeSearchEngine';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { Synonym } from '../types/Synonym';
import { extractEpisodeMarkers } from '../utils/episodeMarkers';
import { currentTraceCandidates, TraceCandidate, traceCandidate, traceNote } from '../utils/searchTrace';
import { runWithSeasonHint } from '../utils/seasonHint';
import { removeLastFourDigitNumber } from '../utils/Utils';
import scheduleFacade from './scheduleFacade';

interface SearchTerm {
    term: string;
    synonym?: Synonym;
}

class SearchFacade {
    searchCache: DbCacheService<IPlayerSearchResult[]> = new DbCacheService('search_cache', 300);
    traceCache: DbCacheService<TraceCandidate[]> = new DbCacheService('search_trace_cache', 300);

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
        onBatch?: (batch: IPlayerSearchResult[]) => void,
        tryAliases: boolean = true
    ): Promise<IPlayerSearchResult[]> {
        // "Show S02E03" / "Show Series 2" say which episode is wanted, not what the show is called:
        // search for the show, and let the season/episode filters do the rest. Explicit season/ep
        // parameters (Sonarr) win over anything typed in the text.
        const markers = extractEpisodeMarkers(inputTerm);
        if (inputTerm != '*') {
            inputTerm = markers.text;
            season ??= markers.season;
            episode ??= markers.episode;
        }
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

        traceNote({ searchedAs: term, season, episode });
        // Native Search 2.0 can fetch only the requested series' episodes (a config option). Such a
        // result set is partial, so it is cached under its own key and never served to another season.
        const narrowToSeason = service === nativeSearchV2Service && (await nativeSearchV2Service.narrowsBySeason(season, synonym));
        const cacheKey = narrowToSeason ? `${term}#season${season}` : term;
        let results: IPlayerSearchResult[] | undefined = await this.searchCache.get(cacheKey);
        if (!results) {
            results = await runWithSeasonHint(narrowToSeason ? season : undefined, async () => onBatch
                ? await service.search(term, synonym, async (batch) => {
                    try {
                        const filtered = await this.#filterForSeasonAndEpisode(batch, season, episode);
                        const processed = await service.processCompletedSearch(filtered, inputTerm, synonym, season, episode);
                        deliver(processed.filter(({ pubDate }) => !pubDate || pubDate < new Date()));
                    } catch {
                        // The final pass below delivers anything a batch couldn't.
                    }
                })
                : await service.search(term, synonym));
            this.searchCache.set(cacheKey, results as IPlayerSearchResult[]);
            this.traceCache.set(cacheKey, currentTraceCandidates('bbc')).catch(() => undefined);
        } else {
            // The search services don't run on a cache hit, so replay what they decided last time.
            traceNote({ cached: true });
            const earlier = await this.traceCache.get(cacheKey).catch(() => undefined);
            if (Array.isArray(earlier)) {
                earlier.filter((c) => c && typeof c.title === 'string').forEach(traceCandidate);
            }
            //Fix the results which are stored as string
            results.forEach((result) => {
                result.pubDate = result.pubDate ? new Date(result.pubDate as unknown as string) : undefined;
            });
        }

        const filteredResults = await this.#filterForSeasonAndEpisode(
            results as IPlayerSearchResult[],
            season,
            episode,
            true
        );

        const processedResults: IPlayerSearchResult[] = await service.processCompletedSearch(filteredResults, inputTerm, synonym, season, episode);

        const now = new Date();
        const finalResults = processedResults.filter(({ pubDate, nzbName, title }) => {
            const aired = !pubDate || pubDate < now;
            if (!aired) {
                traceCandidate({ title: nzbName ?? title, stage: 'episode', kept: false, reason: 'not-aired', detail: 'Not broadcast yet' });
            }
            return aired;
        });
        deliver(finalResults); // whatever the per-batch pass couldn't know about (cache hits, cross-result merging)
        if (finalResults.length === 0 && tryAliases && !synonym) {
            // Sonarr/Radarr search by TVDB's English alias, which iPlayer may not use (e.g. Welsh
            // originals), so retry under the series' other known titles.
            const aliased = await this.#searchAliases(inputTerm, season, episode, onBatch);
            if (aliased.length) return aliased;
        }
        return finalResults;
    }

    async #searchAliases(
        inputTerm: string,
        season?: number,
        episode?: number,
        onBatch?: (batch: IPlayerSearchResult[]) => void
    ): Promise<IPlayerSearchResult[]> {
        let aliases: string[] = [];
        try {
            aliases = (await skyhookService.getAliases(inputTerm)) ?? [];
        } catch {
            return [];
        }
        const seen = new Set<string>();
        const merged: IPlayerSearchResult[] = [];
        for (const alias of aliases) {
            const found = await this.#run(alias, season, episode, onBatch, false);
            for (const result of found) {
                if (!seen.has(result.pid)) {
                    seen.add(result.pid);
                    merged.push(result);
                }
            }
        }
        return merged;
    }

    async #getService(): Promise<AbstractSearchService> {
        const nativeSearchEnabled = await configService.getParameter(IplayarrParameter.NATIVE_SEARCH);
        if (nativeSearchEnabled != 'true') return getIplayerSearchService;
        // The one place the native engine is chosen: anything but an explicit V2 gets the original.
        const engine = await configService.getParameter(IplayarrParameter.NATIVE_SEARCH_ENGINE);
        return engine == NativeSearchEngine.V2 ? nativeSearchV2Service : nativeSearchService;
    }

    async #getTerm(inputTerm: string, season?: number): Promise<SearchTerm> {
        const term = !season ? removeLastFourDigitNumber(inputTerm) : inputTerm;
        const synonym = (await synonymService.getSynonym(inputTerm)) ?? (term !== inputTerm ? await synonymService.getSynonym(term) : undefined);
        return {
            term: synonym ? synonym.target : term,
            synonym,
        };
    }

    async #filterForSeasonAndEpisode(results: IPlayerSearchResult[], season?: number, episode?: number, trace = false) {
        return results.filter((result) => {
            const wrongSeason = !!season && result.series != season;
            const wrongEpisode = !wrongSeason && !!episode && result.episode != episode;
            if (trace && (wrongSeason || wrongEpisode)) {
                traceCandidate({
                    title: result.nzbName ?? result.title,
                    stage: 'episode',
                    kept: false,
                    reason: wrongSeason ? 'wrong-season' : 'wrong-episode',
                    detail: wrongSeason
                        ? `Series ${result.series ?? 'unknown'}, wanted ${season}`
                        : `Episode ${result.episode ?? 'unknown'}, wanted ${episode}`,
                });
            }
            return !wrongSeason && !wrongEpisode;
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