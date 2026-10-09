import axios, { AxiosResponse } from 'axios';
import { Index } from 'lunr';
import lunr from 'lunr';

import { searchResultLimit } from '../../constants/iPlayarrConstants';
import { IPlayerDetails } from '../../types/IPlayerDetails';
import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { IPlayerNewSearchResponse, IPlayerNewSearchResult } from '../../types/responses/iplayer/IPlayerNewSearchResponse';
import { IPlayerEpisodeMetadata } from '../../types/responses/IPlayerMetadataResponse';
import { Synonym } from '../../types/Synonym';
import { createNZBName, getQualityProfile, sanitizeLunrQuery, splitArrayIntoChunks } from '../../utils/Utils';
import iplayerDetailsService from '../iplayerDetailsService';
import loggingService from '../loggingService';
import AbstractSearchService from './AbstractSearchService';

const maxEpisodePages = 10;

class NativeSearchService implements AbstractSearchService {

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
        if (response.status == 200) {
            const {
                new_search: { results },
            } = response.data;

            const lunrResults: Index.Result[] = this.#indexAndReSearch(term, results);
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
                const brandPid = await iplayerDetailsService.findBrandForPid(ref);
                const searchHitMetadata = await iplayerDetailsService.getMetadata(ref);
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
        };
    }

    #indexAndReSearch(term: string, results: IPlayerNewSearchResult[]): Index.Result[] {
        //Index them each and search again, iPlayer's search is WAY to fuzzy
        const lunrIndex: lunr.Index = lunr(function (this: lunr.Builder) {
            this.ref('pid');
            this.field('pid');
            this.field('title');

            results.forEach(({ id: pid, title }) => this.add({ pid, title }))
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

export default new NativeSearchService();