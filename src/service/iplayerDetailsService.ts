import axios, { Axios, AxiosResponse } from 'axios';

import { pidRegex, searchResultLimit } from '../constants/iPlayarrConstants';
import { IPlayerDetails } from '../types/IPlayerDetails';
import { IPlayerEpisodeMetadata, IPlayerEpisodesResponse, IPlayerMetadataResponse } from '../types/responses/IPlayerMetadataResponse';
import { withRetry } from '../utils/retry';
import { calculateSeasonAndEpisode } from '../utils/Utils';
import DbCacheService from './db/dbCacheService';
import episodeDetailsCache from './episodeDetailsCache';

class IPlayerDetailsService {
    metadataCache: DbCacheService<IPlayerMetadataResponse> = new DbCacheService('metadata_cache', 86400, { label: 'Programme metadata', description: 'BBC programme details per PID (title, synopsis, parents).' });
    // IBL episode-list pages per programme/series pid. Short TTL: new episodes must show up, and the
    // hourly subscription check relies on seeing them.
    episodesCache: DbCacheService<IPlayerEpisodeMetadata[]> = new DbCacheService('ibl_episodes', 1800, { label: 'Episode lists', description: 'Pages of episodes per brand/series. Keep short so new episodes appear and subscriptions see them.' });
    // ids BBC answered 404 for (e.g. live channel ids like bbc_two_england, which several pages
    // ask details for) mapped to when to try again - otherwise every request repeats the BBC round trip.
    notFound: Map<string, number> = new Map();
    static readonly NOT_FOUND_TTL_MS = 60 * 60 * 1000;

    async detailsForEpisodeMetadata(episodes: IPlayerEpisodeMetadata[]): Promise<IPlayerDetails[]> {
        const results = await Promise.allSettled(
            episodes.map(async (episode) => {
                const details = await this.episodeDetails(episode.id);
                details.firstBroadcast = episode.release_date_time;
                return details;
            })
        );

        return results
            .filter(result => result.status === 'fulfilled')
            .map((result: PromiseFulfilledResult<IPlayerDetails>) => result.value);
    }

    async details(pids: string[], axiosInstance: Axios = axios): Promise<IPlayerDetails[]> {
        const results = await Promise.allSettled(
            pids.map(pid => this.episodeDetails(pid, axiosInstance))
        );

        return results
            .filter(result => result.status === 'fulfilled')
            .map((result: PromiseFulfilledResult<IPlayerDetails>) => result.value);
    }

    async episodeDetails(pid: string, axiosInstance: Axios = axios): Promise<IPlayerDetails> {
        const cached = await episodeDetailsCache.get(pid);
        if (cached) return cached;
        const { programme } = await this.getMetadata(pid, axiosInstance);
        const [type, episode, episodeTitle, series] = await calculateSeasonAndEpisode(programme);
        // The immediate parent is often a mid-tier "series" (season), not the top-level "brand" -
        // only a brand's episode listing is guaranteed non-empty, so climb the rest of the way when
        // the parent isn't already one (see findBrandForPid / browseService.programme's own climb).
        const parent = programme.parent?.programme;
        let brandLookupFailed = false;
        const seriesPid = !parent
            ? undefined
            : parent.type === 'brand'
                ? parent.pid
                : await this.findBrandForPid(parent.pid).catch(() => {
                    brandLookupFailed = true;
                    return undefined;
                });
        const details: IPlayerDetails = {
            pid,
            title: programme.display_title?.title ?? programme.title,
            episode,
            episodeTitle,
            series,
            channel: programme.ownership?.service?.title,
            category: programme.categories?.length ? programme.categories[0].title : '',
            description: programme.medium_synopsis,
            runtime: programme.versions?.length ? programme.versions[0].duration / 60 : 0,
            firstBroadcast: programme.first_broadcast_date ?? undefined,
            link: `https://www.bbc.co.uk/programmes/${pid}`,
            thumbnail: programme.image
                ? `json-api/thumbnail/${programme.image.pid}.jpg`
                : undefined,
            type,
            seriesPid,
        };
        // A failed brand climb is usually transient, so don't keep that gap for hours.
        if (!brandLookupFailed) await episodeDetailsCache.set(pid, details).catch(() => undefined);
        return details;
    }

    async getMetadata(pid: string, axiosInstance: Axios = axios): Promise<IPlayerMetadataResponse> {
        const retryAt = this.notFound.get(pid);
        if (retryAt !== undefined) {
            if (retryAt > Date.now()) throw new Error(`No programme metadata for PID ${pid} (cached 404)`);
            this.notFound.delete(pid);
        }
        // When the BBC's programme pages are down they redirect to an HTML "Service Temporarily Unavailable" page,
        // which axios follows and reports as a 200. That must not be taken for metadata or cached for a day.
        const isMetadata = (value: unknown): value is IPlayerMetadataResponse =>
            typeof value === 'object' && value !== null && typeof (value as IPlayerMetadataResponse).programme === 'object' && (value as IPlayerMetadataResponse).programme !== null;
        const fetchMetadata = async (): Promise<IPlayerMetadataResponse> => {
            const response: { data: unknown } = await axiosInstance.get(`https://www.bbc.co.uk/programmes/${pid}.json`);
            if (!isMetadata(response.data)) {
                throw new Error(`The BBC programme page for ${pid} returned an error page instead of data - the BBC site may be temporarily unavailable`);
            }
            return response.data;
        };
        try {
            const value = await this.metadataCache.getOr(pid, fetchMetadata);
            if (isMetadata(value)) return value;
            // An error page cached before this check existed: fetch it again and replace the bad entry.
            const fresh = await fetchMetadata();
            await this.metadataCache.set(pid, fresh).catch(() => undefined);
            return fresh;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                this.notFound.set(pid, Date.now() + IPlayerDetailsService.NOT_FOUND_TTL_MS);
            }
            console.error(`Error fetching metadata for PID ${pid}: ${error}`);
            throw error;
        }
    }

    async findBrandForPid(pid: string, checked: string[] = []): Promise<string | undefined> {
        const { programme }: IPlayerMetadataResponse = await this.getMetadata(pid);
        if (programme == null) return undefined;

        if (programme.type == 'brand') {
            return programme.pid;
        } else if (programme.parent) {
            if (!checked.includes(programme.parent.programme.pid) && programme.parent.programme.pid != pid) {
                return await this.findBrandForPid(programme.parent.programme.pid, [...checked, pid]);
            }
        }
        return undefined;
    }

    async getSeriesEpisodes(pid: string, page: number = 1, perPage: number = searchResultLimit): Promise<IPlayerEpisodeMetadata[]> {
        const cacheKey = `${pid}_${perPage}_${page}`;
        const cached = await this.episodesCache.get(cacheKey);
        if (cached) return cached;
        try {
            const response: AxiosResponse<IPlayerEpisodesResponse> = await withRetry(() => axios.get(
                `https://ibl.api.bbci.co.uk/ibl/v1/programmes/${encodeURIComponent(pid)}/episodes?per_page=${perPage}${page > 1 ? `&page=${page}` : ''}`
            ));
            const elements = response.data.programme_episodes.elements ?? [];
            await this.episodesCache.set(cacheKey, elements).catch(() => undefined);
            return elements;
        } catch {
            return [];
        }
    }

    // Like getSeriesEpisodes, but retries (with backoff) and says whether the page actually loaded, so a caller
    // can tell a failed page from a genuinely short (final) one. Used by Native Search V2.
    async getSeriesEpisodesChecked(pid: string, page: number = 1, perPage: number = searchResultLimit): Promise<{ elements: IPlayerEpisodeMetadata[]; failed: boolean }> {
        const url = `https://ibl.api.bbci.co.uk/ibl/v1/programmes/${encodeURIComponent(pid)}/episodes?per_page=${perPage}${page > 1 ? `&page=${page}` : ''}`;
        const cacheKey = `${pid}_${perPage}_${page}`;
        const cached = await this.episodesCache.get(cacheKey);
        if (cached) return { elements: cached, failed: false };
        try {
            // Backs off and honours Retry-After on a 429, instead of retrying straight away.
            const response: AxiosResponse<IPlayerEpisodesResponse> = await withRetry(() => axios.get(url), {
                retries: 2,
                retryUnknown: true,
            });
            const elements = response.data.programme_episodes.elements ?? [];
            await this.episodesCache.set(cacheKey, elements).catch(() => undefined);
            return { elements, failed: false };
        } catch {
            return { elements: [], failed: true };
        }
    }

    async findBrandForUrl(url: string): Promise<string | undefined> {
        const match = url.replace('/episodes', '').match(pidRegex);
        if (match) {
            const pid = match[1];
            return await this.findBrandForPid(pid);
        }
    }
}

export default new IPlayerDetailsService();
