import axios, { Axios, AxiosResponse } from 'axios';

import { pidRegex, searchResultLimit } from '../constants/iPlayarrConstants';
import { IPlayerDetails } from '../types/IPlayerDetails';
import { IPlayerEpisodeMetadata, IPlayerEpisodesResponse, IPlayerMetadataResponse } from '../types/responses/IPlayerMetadataResponse';
import { calculateSeasonAndEpisode } from '../utils/Utils';
import RedisCacheService from './redis/redisCacheService';

class IPlayerDetailsService {
    metadataCache: RedisCacheService<IPlayerMetadataResponse> = new RedisCacheService('metadata_cache', 86400); // 24 hours

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
        const { programme } = await this.getMetadata(pid, axiosInstance);
        const [type, episode, episodeTitle, series] = await calculateSeasonAndEpisode(programme);
        // The immediate parent is often a mid-tier "series" (season), not the top-level "brand" -
        // only a brand's episode listing is guaranteed non-empty, so climb the rest of the way when
        // the parent isn't already one (see findBrandForPid / browseService.programme's own climb).
        const parent = programme.parent?.programme;
        const seriesPid = !parent
            ? undefined
            : parent.type === 'brand'
                ? parent.pid
                : await this.findBrandForPid(parent.pid).catch(() => undefined);
        return {
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
    }

    async getMetadata(pid: string, axiosInstance: Axios = axios): Promise<IPlayerMetadataResponse> {
        try {
            return await this.metadataCache.getOr(pid, async () => {
                const response: { data: IPlayerMetadataResponse } = await axiosInstance.get(`https://www.bbc.co.uk/programmes/${pid}.json`);
                return response.data;
            });
        } catch (error) {
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
        try {
            const response: AxiosResponse<IPlayerEpisodesResponse> = await axios.get(
                `https://ibl.api.bbci.co.uk/ibl/v1/programmes/${encodeURIComponent(pid)}/episodes?per_page=${perPage}${page > 1 ? `&page=${page}` : ''}`
            );
            return response.data.programme_episodes.elements;
        } catch {
            return [];
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
