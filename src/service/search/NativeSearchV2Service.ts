import axios, { AxiosResponse } from 'axios';
import { Index } from 'lunr';
import lunr from 'lunr';
import pLimit from 'p-limit';

import { nativeSeriesRegex, searchResultLimit } from '../../constants/iPlayarrConstants';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { IPlayerDetails } from '../../types/IPlayerDetails';
import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { IPlayerNewSearchResponse, IPlayerNewSearchResult } from '../../types/responses/iplayer/IPlayerNewSearchResponse';
import { IPlayerEpisodeMetadata } from '../../types/responses/IPlayerMetadataResponse';
import { Synonym } from '../../types/Synonym';
import { traceCandidate, traceNote } from '../../utils/searchTrace';
import { seasonHint } from '../../utils/seasonHint';
import { firstMissingTerm, titleRank } from '../../utils/titleMatch';
import { getPotentialRoman, getQualityProfile, sanitizeLunrQuery, splitArrayIntoChunks } from '../../utils/Utils';
import configService from '../configService';
import iplayerDetailsService from '../iplayerDetailsService';
import loggingService from '../loggingService';
import searchSettingsService from '../searchSettingsService';
import AbstractSearchService from './AbstractSearchService';
import nativeSearchService from './NativeSearchService';
import newSearchCache from './newSearchCache';

const maxEpisodePages = 10;
const episodeChunkSize = 5;
const chunksInFlight = 3;
const lookupConcurrency = 5;
// new-search answers with at most this many hits; hitting it means a short or generic term may have
// had real matches crowded out.
const newSearchHitCap = 24;

function seriesNumberOf(title: string | undefined): number | undefined {
    const match = title?.match(nativeSeriesRegex);
    return match ? getPotentialRoman(match[1]) : undefined;
}

// "Show Name Episode Title" -> "Show Name Episode", "Show Name": at most three, never below two words.
function shortenedTerms(term: string): string[] {
    const words = term.split(/\s+/).filter(Boolean);
    const shorter: string[] = [];
    for (let count = words.length - 1; count >= 2 && shorter.length < 3; count--) {
        shorter.push(words.slice(0, count).join(' '));
    }
    return shorter;
}

interface ContainerLookup {
    ref: string;
    containerPid?: string;
    failed?: boolean;
}

// EXPERIMENTAL "Native Search 2.0" (NATIVE_SEARCH_ENGINE = 'V2'). Produces the same results as
// NativeSearchService (V1, which is left untouched and remains the default) but:
//  - looks up every hit's brand/type concurrently instead of one at a time,
//  - fetches episode details several chunks at a time (result order is unchanged),
//  - retries a failed episode-list page and tells a failed page apart from a short final one,
//  - pages nested series the same way as the top-level container,
//  - logs whenever a cap truncates results or a lookup fails.
// Result building and exemption filtering are delegated to V1 so the two cannot drift.
class NativeSearchV2Service implements AbstractSearchService {
    async search(term: string, synonym?: Synonym, onBatch?: (batch: IPlayerSearchResult[]) => void): Promise<IPlayerSearchResult[]> {
        const { sizeFactor } = await getQualityProfile();
        const matchAllWords = (await searchSettingsService.get(IplayarrParameter.SEARCH_MATCH_ALL_WORDS)) !== 'false';

        // Nothing matched every word: retry with the trailing words dropped ("Show Name Episode Title"
        // -> "Show Name"), keeping the all-words rule against the shorter term.
        let results: IPlayerNewSearchResult[] = [];
        let lunrResults: Index.Result[] = [];
        for (const candidate of [term, ...shortenedTerms(term)]) {
            const fetched = await this.#fetchHits(candidate);
            if (!fetched) {
                if (candidate === term) return [];
                continue;
            }
            results = fetched;
            if (results.length >= newSearchHitCap) {
                loggingService.log(`Native search 2.0: "${candidate}" returned the maximum ${newSearchHitCap} BBC hits, matches beyond that cannot be seen`);
                traceCandidate({
                    title: `BBC returned the maximum ${newSearchHitCap} hits`,
                    stage: 'bbc',
                    kept: false,
                    reason: 'hit-cap',
                    detail: `Matches beyond the first ${newSearchHitCap} cannot be seen - try a more specific search`,
                });
            }
            lunrResults = this.#indexAndReSearch(candidate, results, matchAllWords);
            if (candidate !== term) traceNote({ retriedAs: candidate });
            if (lunrResults.length) break;
        }
        const hitTitles = new Map(results.map(({ id, title }) => [id, title]));
        const lookups = await this.#lookupContainers(lunrResults.map(({ ref }) => ref));

        const pidLedger: Set<string> = new Set();
        const infoPidLedger: Set<string> = new Set();
        const searchResults: IPlayerSearchResult[] = [];

        // Turns newly found details into results and reports them as soon as they exist.
        const collect = async (found: IPlayerDetails[]) => {
            const batch: IPlayerSearchResult[] = [];
            for (const info of found) {
                if (infoPidLedger.has(info.pid)) continue;
                infoPidLedger.add(info.pid);
                batch.push(await nativeSearchService.createSearchResult(info.title, info, sizeFactor, synonym));
            }
            searchResults.push(...batch);
            if (batch.length) onBatch?.(batch);
        };

        for (const { ref, containerPid, failed } of lookups) {
            if (failed) {
                traceCandidate({
                    title: hitTitles.get(ref) ?? ref,
                    stage: 'bbc',
                    kept: false,
                    reason: 'lookup-failed',
                    detail: 'Could not look up this programme, so its episodes were skipped',
                });
                continue;
            }

            if (containerPid) {
                if (!pidLedger.has(containerPid)) {
                    pidLedger.add(containerPid);
                    const episodes = await this.#expandEpisodesFromContainer(containerPid);
                    await this.#collectEpisodes(episodes, collect);
                }
            } else {
                await collect(await iplayerDetailsService.details([ref]));
            }

            if (searchResults.length >= searchResultLimit) {
                loggingService.log(`Native search 2.0: "${term}" stopped at the ${searchResultLimit} result limit`);
                traceCandidate({
                    title: `Stopped at ${searchResultLimit} results`,
                    stage: 'episode',
                    kept: false,
                    reason: 'result-limit',
                    detail: 'Further matches were not looked up',
                });
                break;
            }
        }

        return searchResults;
    }

    // undefined when the BBC search itself failed.
    async #fetchHits(term: string): Promise<IPlayerNewSearchResult[] | undefined> {
        const url = `https://ibl.api.bbc.co.uk/ibl/v1/new-search?q=${encodeURIComponent(term)}`;
        const cached = await newSearchCache.get(term.toLowerCase());
        if (cached) return cached;
        try {
            const response: AxiosResponse<IPlayerNewSearchResponse> = await axios.get(url);
            if (response.status != 200) return undefined;
            const hits = response.data.new_search.results;
            await newSearchCache.set(term.toLowerCase(), hits).catch(() => undefined);
            return hits;
        } catch (err: any) {
            loggingService.error(`BBC search API request failed for term "${term}": ${err?.message ?? err}`);
            return undefined;
        }
    }

    // Brand/type lookups are cache-backed and independent, so run them side by side. Order is kept.
    async #lookupContainers(refs: string[]): Promise<ContainerLookup[]> {
        const limit = pLimit(lookupConcurrency);
        return Promise.all(
            refs.map((ref) =>
                limit(async (): Promise<ContainerLookup> => {
                    try {
                        const brandPid = await iplayerDetailsService.findBrandForPid(ref);
                        const metadata = await iplayerDetailsService.getMetadata(ref);
                        const type = metadata.programme.type;
                        const fallbackContainerPid = type == 'series' || type == 'brand' ? ref : undefined;
                        return { ref, containerPid: brandPid ?? fallbackContainerPid };
                    } catch (err: any) {
                        loggingService.error(`Native search 2.0: lookup failed for ${ref}: ${err?.message ?? err}`);
                        return { ref, failed: true };
                    }
                })
            )
        );
    }

    // Detail fetches run chunksInFlight chunks at a time; results are still collected chunk by chunk
    // in order so the output matches a strictly sequential run.
    async #collectEpisodes(episodes: IPlayerEpisodeMetadata[], collect: (found: IPlayerDetails[]) => Promise<void>): Promise<void> {
        const chunks = splitArrayIntoChunks(episodes, episodeChunkSize);
        for (let i = 0; i < chunks.length; i += chunksInFlight) {
            const group = chunks.slice(i, i + chunksInFlight);
            const detailGroups = await Promise.all(group.map((chunk) => iplayerDetailsService.detailsForEpisodeMetadata(chunk)));
            for (const details of detailGroups) {
                await collect(details);
            }
        }
    }

    async #listContainer(containerPid: string): Promise<IPlayerEpisodeMetadata[]> {
        const all: IPlayerEpisodeMetadata[] = [];
        for (let page = 1; page <= maxEpisodePages; page++) {
            const { elements, failed } = await iplayerDetailsService.getSeriesEpisodesChecked(containerPid, page);
            if (failed) {
                loggingService.error(`Native search 2.0: episode list page ${page} of ${containerPid} failed, results for it may be incomplete`);
                traceCandidate({
                    title: `Episode list ${containerPid}, page ${page}`,
                    stage: 'episode',
                    kept: false,
                    reason: 'page-failed',
                    detail: 'The BBC episode list could not be loaded, so results for it may be incomplete',
                });
                break;
            }
            all.push(...elements);
            if (elements.length < searchResultLimit) break;
            if (page == maxEpisodePages) {
                loggingService.log(`Native search 2.0: ${containerPid} has more than ${maxEpisodePages * searchResultLimit} episodes, the rest are not listed`);
                traceCandidate({
                    title: `Episode list ${containerPid}`,
                    stage: 'episode',
                    kept: false,
                    reason: 'page-cap',
                    detail: `More than ${maxEpisodePages * searchResultLimit} episodes; the rest are not listed`,
                });
            }
        }
        return all;
    }

    // Whether a search for this season may fetch only that series' episodes. Off unless the option is
    // on, and never when the numbers don't come straight from BBC's series containers: a synonym
    // (season offsets) or airdate numbering renumbers episodes, so another container could match.
    async narrowsBySeason(season?: number, synonym?: Synonym): Promise<boolean> {
        if (!season || synonym) return false;
        const enabled = (await searchSettingsService.get(IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY)) === 'true';
        const airdateNumbering = (await configService.getParameter(IplayarrParameter.AIRDATE_NUMBERING)) === 'true';
        return enabled && !airdateNumbering;
    }

    async #expandEpisodesFromContainer(containerPid: string): Promise<IPlayerEpisodeMetadata[]> {
        const containerChildren = await this.#listContainer(containerPid);
        let directEpisodes = containerChildren.filter(({ type, release_date_time }) => type == 'episode' && release_date_time != null);
        let childContainers = containerChildren.filter(({ type }) => type == 'series' || type == 'brand');

        // Only the requested series: its container is the one titled "Series 2" / "2" / "II". When no
        // container matches (episodes listed directly, differently labelled series) fetch everything
        // as usual rather than risk missing the episode.
        const wanted = seasonHint();
        if (wanted !== undefined) {
            const matching = childContainers.filter(({ title }) => seriesNumberOf(title) === wanted);
            if (matching.length) {
                childContainers = matching;
                directEpisodes = [];
                traceNote({ narrowedTo: `Series ${wanted}` });
            }
        }

        const nestedChildren = (await Promise.all(childContainers.map(({ id }) => this.#listContainer(id)))).flat();
        const nestedEpisodes = nestedChildren.filter(({ type, release_date_time }) => type == 'episode' && release_date_time != null);

        const dedupedByPid = new Map<string, IPlayerEpisodeMetadata>();
        for (const episode of [...directEpisodes, ...nestedEpisodes]) {
            dedupedByPid.set(episode.id, episode);
        }
        return [...dedupedByPid.values()];
    }

    async processCompletedSearch(results: IPlayerSearchResult[], inputTerm: string, synonym?: Synonym): Promise<IPlayerSearchResult[]> {
        return nativeSearchService.processCompletedSearch(results, inputTerm, synonym);
    }

    #indexAndReSearch(term: string, results: IPlayerNewSearchResult[], matchAllWords: boolean): Index.Result[] {
        //Index them each and search again, iPlayer's search is WAY to fuzzy
        const lunrIndex: lunr.Index = lunr(function (this: lunr.Builder) {
            // lunr's default stop words (him, her, and, the...) would erase titles like "Him & Her"
            // from both the index and the query, so nothing could ever match them.
            this.pipeline.remove(lunr.stopWordFilter);
            this.searchPipeline.remove(lunr.stopWordFilter);
            this.ref('pid');
            this.field('pid');
            this.field('title');

            results.forEach(({ id: pid, title }) => this.add({ pid, title }));
        });
        const sanitizedTerm = sanitizeLunrQuery(term);
        if (!sanitizedTerm) {
            return [];
        }
        try {
            const hits = lunrIndex.search(sanitizedTerm);
            const titles = new Map(results.map(({ id, title }) => [id, title]));
            const hitRefs = new Set(hits.map(({ ref }) => ref));
            for (const { id, title } of results) {
                if (!hitRefs.has(id)) {
                    traceCandidate({ title, stage: 'bbc', kept: false, reason: 'no-match', detail: 'None of the search words match this title' });
                }
            }
            const ranked = hits.filter(({ ref }) => {
                const title = titles.get(ref) ?? '';
                const missing = matchAllWords ? firstMissingTerm(title, term) : undefined;
                traceCandidate(
                    missing === undefined
                        ? { title, stage: 'bbc', kept: true }
                        : { title, stage: 'bbc', kept: false, reason: 'missing-word', detail: `Missing the word "${missing}"` }
                );
                return missing === undefined;
            });
            // Exact title first, then titles starting with it, then the rest (stable, so lunr's
            // score order is kept within each group) - the result cap then cuts the weakest.
            return ranked.sort((a, b) => titleRank(titles.get(a.ref) ?? '', term) - titleRank(titles.get(b.ref) ?? '', term));
        } catch (err: any) {
            if (err && err.name === 'QueryParseError') {
                loggingService.error(`Lunr QueryParseError for term "${term}": ${err.message}`);
                return [];
            }
            throw err;
        }
    }
}

export default new NativeSearchV2Service();
