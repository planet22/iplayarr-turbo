import axios, { AxiosResponse } from 'axios';
import { Index } from 'lunr';

import { searchResultLimit } from '../../constants/iPlayarrConstants';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { IPlayerDetails } from '../../types/IPlayerDetails';
import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { IPlayerNewSearchResponse, IPlayerNewSearchResult } from '../../types/responses/iplayer/IPlayerNewSearchResponse';
import { IPlayerEpisodeMetadata } from '../../types/responses/IPlayerMetadataResponse';
import { Synonym } from '../../types/Synonym';
import { lunrTitleSearch } from '../../utils/lunrTitleSearch';
import { markSearchIncomplete } from '../../utils/searchCompleteness';
import { createNZBName, getQualityProfile, splitArrayIntoChunks } from '../../utils/Utils';
import iplayerDetailsService from '../iplayerDetailsService';
import loggingService from '../loggingService';
import searchSettingsService from '../searchSettingsService';
import AbstractSearchService from './AbstractSearchService';
import newSearchCache from './newSearchCache';

const maxEpisodePages = 10;
class NativeSearchService implements AbstractSearchService {

    async search(term: string, synonym?: Synonym, onBatch?: (batch: IPlayerSearchResult[]) => void): Promise<IPlayerSearchResult[]> {
        const { sizeFactor } = await getQualityProfile();
        const matchAllWords = (await searchSettingsService.get(IplayarrParameter.SEARCH_MATCH_ALL_WORDS)) !== 'false';
        const url = `https://ibl.api.bbc.co.uk/ibl/v1/new-search?q=${encodeURIComponent(term)}`;
        let results: IPlayerNewSearchResult[] | undefined = await newSearchCache.get(term.toLowerCase());
        if (!results) {
            let response: AxiosResponse<IPlayerNewSearchResponse>;
            try {
                response = await axios.get(url);
            } catch (err: any) {
                loggingService.error(`BBC search API request failed for term "${term}": ${err?.message ?? err}`);
                markSearchIncomplete();
                return [];
            }
            if (response.status == 200) {
                results = response.data.new_search.results;
                await newSearchCache.set(term.toLowerCase(), results).catch(() => undefined);
            } else {
                markSearchIncomplete();
            }
        }
        if (results) {
            const lunrResults: Index.Result[] = lunrTitleSearch(term, results, matchAllWords);
            const pidLedger: string[] = [];
            const infoPidLedger: Set<string> = new Set();

            const searchResults: IPlayerSearchResult[] = [];

            // Turns newly found details into results and reports them as soon as they exist.
            const collect = async (found: IPlayerDetails[]) => {
                const fresh = found.filter(({ pid }) => !infoPidLedger.has(pid));
                const batch: IPlayerSearchResult[] = [];
                for (const info of fresh) {
                    if (infoPidLedger.has(info.pid)) continue;
                    infoPidLedger.add(info.pid);
                    batch.push(await this.createSearchResult(info.title, info, sizeFactor, synonym));
                }
                searchResults.push(...batch);
                if (batch.length) onBatch?.(batch);
            };

            for (const { ref } of lunrResults) {
              try {
                // Independent lookups for the same hit, so they go out together.
                const [brandPid, searchHitMetadata] = await Promise.all([
                    iplayerDetailsService.findBrandForPid(ref),
                    iplayerDetailsService.getMetadata(ref),
                ]);
                const fallbackContainerPid = searchHitMetadata.programme.type == 'series' || searchHitMetadata.programme.type == 'brand'
                    ? ref
                    : undefined;
                const containerPid = brandPid ?? fallbackContainerPid;

                if (containerPid) {
                    if (!pidLedger.includes(containerPid)) {
                        const episodes = await this.#expandEpisodesFromContainer(containerPid);
                        const chunks = splitArrayIntoChunks(episodes, 5);
                        for (const chunk of chunks) {
                            await collect(await iplayerDetailsService.detailsForEpisodeMetadata(chunk));
                        }
                        pidLedger.push(containerPid);
                    }
                } else {
                    await collect(await iplayerDetailsService.details([ref]));
                }
              } catch (err: any) {
                // One bad hit must not throw away the results already found.
                loggingService.error(`Search hit ${ref} skipped: ${err?.message ?? err}`);
                markSearchIncomplete();
              }

                //Limit to only 150 results
                if (searchResults.length >= searchResultLimit) {
                    break;
                }
            }

            return searchResults;
        } else {
            return [];
        }
    }

    async #expandEpisodesFromContainer(containerPid: string): Promise<IPlayerEpisodeMetadata[]> {
        // The BBC list is paged (searchResultLimit per page), so keep fetching until a short page
        const containerChildren: IPlayerEpisodeMetadata[] = await iplayerDetailsService.getSeriesEpisodes(containerPid);
        for (let page = 2; page <= maxEpisodePages && containerChildren.length == (page - 1) * searchResultLimit; page++) {
            containerChildren.push(...await iplayerDetailsService.getSeriesEpisodes(containerPid, page));
        }
        const directEpisodes = containerChildren.filter(({ type, release_date_time }) => type == 'episode' && release_date_time != null);
        const childContainers = containerChildren.filter(({ type }) => type == 'series' || type == 'brand');

        const nestedChildren = (await Promise.all(
            childContainers.map(({ id }) => iplayerDetailsService.getSeriesEpisodes(id))
        )).flat();
        const nestedEpisodes = nestedChildren.filter(({ type, release_date_time }) => type == 'episode' && release_date_time != null);

        const combined = [...directEpisodes, ...nestedEpisodes];
        const dedupedByPid = new Map<string, IPlayerEpisodeMetadata>();
        for (const episode of combined) {
            dedupedByPid.set(episode.id, episode);
        }
        return [...dedupedByPid.values()];
    }

    async processCompletedSearch(results: IPlayerSearchResult[], _inputTerm: string, synonym?: Synonym): Promise<IPlayerSearchResult[]> {
        const exemptions = synonym?.exemptions?.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        return exemptions?.length ? results.filter(r => exemptions.every(ex => !r.title.toLowerCase().includes(ex))) : results;
    }

    async createSearchResult(
        term: string,
        details: IPlayerDetails,
        sizeFactor: number,
        synonym?: Synonym
    ): Promise<IPlayerSearchResult> {
        return {
            number: 0,
            title: details.title,
            channel: details.channel || '',
            pid: details.pid,
            request: {
                term,
                line: term,
            },
            episode: details.episode,
            pubDate: details.firstBroadcast ? new Date(details.firstBroadcast) : undefined,
            series: details.series,
            type: details.type,
            size: details.runtime ? Math.floor(details.runtime * 60 * sizeFactor) : undefined,
            nzbName: await createNZBName(details, synonym),
            episodeTitle: details.episodeTitle,
            runtimeSeconds: details.runtime ? Math.floor(details.runtime * 60) : undefined,
            seriesPid: details.seriesPid,
            audioOnly: details.audioOnly,
        };
    }

}

export default new NativeSearchService();