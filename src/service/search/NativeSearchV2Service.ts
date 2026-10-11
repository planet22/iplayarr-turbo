import axios, { AxiosResponse } from 'axios';
import { Index } from 'lunr';
import lunr from 'lunr';
import pLimit from 'p-limit';

import { searchResultLimit } from '../../constants/iPlayarrConstants';
import { IPlayerDetails } from '../../types/IPlayerDetails';
import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { IPlayerNewSearchResponse, IPlayerNewSearchResult } from '../../types/responses/iplayer/IPlayerNewSearchResponse';
import { IPlayerEpisodeMetadata } from '../../types/responses/IPlayerMetadataResponse';
import { Synonym } from '../../types/Synonym';
import { getQualityProfile, sanitizeLunrQuery, splitArrayIntoChunks } from '../../utils/Utils';
import iplayerDetailsService from '../iplayerDetailsService';
import loggingService from '../loggingService';
import AbstractSearchService from './AbstractSearchService';
import nativeSearchService from './NativeSearchService';

const maxEpisodePages = 10;
const episodeChunkSize = 5;
const chunksInFlight = 3;
const lookupConcurrency = 5;
// new-search answers with at most this many hits; hitting it means a short or generic term may have
// had real matches crowded out.
const newSearchHitCap = 24;

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
        const url = `https://ibl.api.bbc.co.uk/ibl/v1/new-search?q=${encodeURIComponent(term)}`;
        let response: AxiosResponse<IPlayerNewSearchResponse>;
        try {
            response = await axios.get(url);
        } catch (err: any) {
            loggingService.error(`BBC search API request failed for term "${term}": ${err?.message ?? err}`);
            return [];
        }
        if (response.status != 200) return [];

        const {
            new_search: { results },
        } = response.data;
        if (results.length >= newSearchHitCap) {
            loggingService.log(`Native search 2.0: "${term}" returned the maximum ${newSearchHitCap} BBC hits, matches beyond that cannot be seen`);
        }

        const lunrResults: Index.Result[] = this.#indexAndReSearch(term, results);
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
            if (failed) continue;

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
                break;
            }
        }

        return searchResults;
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
                break;
            }
            all.push(...elements);
            if (elements.length < searchResultLimit) break;
            if (page == maxEpisodePages) {
                loggingService.log(`Native search 2.0: ${containerPid} has more than ${maxEpisodePages * searchResultLimit} episodes, the rest are not listed`);
            }
        }
        return all;
    }

    async #expandEpisodesFromContainer(containerPid: string): Promise<IPlayerEpisodeMetadata[]> {
        const containerChildren = await this.#listContainer(containerPid);
        const directEpisodes = containerChildren.filter(({ type, release_date_time }) => type == 'episode' && release_date_time != null);
        const childContainers = containerChildren.filter(({ type }) => type == 'series' || type == 'brand');

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

    #indexAndReSearch(term: string, results: IPlayerNewSearchResult[]): Index.Result[] {
        //Index them each and search again, iPlayer's search is WAY to fuzzy
        const lunrIndex: lunr.Index = lunr(function (this: lunr.Builder) {
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
            return lunrIndex.search(sanitizedTerm);
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
