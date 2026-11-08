import axios, { Axios, AxiosResponse } from 'axios';

import { pidRegex, searchResultLimit } from '../constants/iPlayarrConstants';
import { IPlayerDetails } from '../types/IPlayerDetails';
import { IPlayerContributor, IPlayerEpisodeMetadata, IPlayerEpisodesResponse, IPlayerMetadataResponse } from '../types/responses/IPlayerMetadataResponse';
import { expiryOf } from '../utils/availability';
import { setBounded } from '../utils/boundedMap';
import { IblArtwork, IblEpisodeExtras, parseIblArtwork, parseIblEpisodeExtras } from '../utils/iblEpisode';
import { withRetry } from '../utils/retry';
import { markSearchIncomplete } from '../utils/searchCompleteness';
import { ProgrammeNotFoundError } from '../utils/upstreamError';
import { calculateSeasonAndEpisode } from '../utils/Utils';
import DbCacheService from './db/dbCacheService';
import episodeDetailsCache from './episodeDetailsCache';

// More than enough for the programmes actually asked for; stops a run of made-up pids growing the map for ever.
const MAX_NOT_FOUND = 5000;

class IPlayerDetailsService {
    metadataCache: DbCacheService<IPlayerMetadataResponse> = new DbCacheService('metadata_cache', 86400, { label: 'Programme metadata', description: 'BBC programme details per PID (title, synopsis, parents).' });
    // IBL episode-list pages per programme/series pid. Short TTL: new episodes must show up, and the
    // hourly subscription check relies on seeing them.
    episodesCache: DbCacheService<IPlayerEpisodeMetadata[]> = new DbCacheService('ibl_episodes', 1800, { label: 'Episode lists', description: 'Pages of episodes per brand/series. Keep short so new episodes appear and subscriptions see them.' });
    castCache: DbCacheService<IPlayerContributor[]> = new DbCacheService('cast_cache', 7 * 86400, { label: 'Cast and crew', description: 'Cast and crew per episode version, for the .nfo files.' });
    iblExtrasCache: DbCacheService<IblEpisodeExtras> = new DbCacheService('ibl_episode_extras', 86400, { label: 'Episode extras', description: 'Editorial tagline and running time per episode from iPlayer\'s listing API, for the .nfo files.' });
    iblArtworkCache: DbCacheService<IblArtwork> = new DbCacheService('ibl_artwork', 86400, { label: 'Episode artwork', description: 'Addresses of an episode\'s pictures and its show\'s logo from iPlayer\'s listing API, for the Jellyfin images.' });
    // ids BBC answered 404 for (e.g. live channel ids like bbc_two_england, which several pages
    // ask details for) mapped to when to try again - otherwise every request repeats the BBC round trip.
    notFound: Map<string, number> = new Map();
    static readonly NOT_FOUND_TTL_MS = 60 * 60 * 1000;

    // brandPid: when the episodes were listed from a brand, its pid - saves each episode climbing to it.
    async detailsForEpisodeMetadata(episodes: IPlayerEpisodeMetadata[], brandPid?: string): Promise<IPlayerDetails[]> {
        const results = await Promise.allSettled(
            episodes.map(async (episode) => {
                const details = await this.episodeDetails(episode.id, axios, brandPid);
                details.firstBroadcast = episode.release_date_time;
                // Straight from iBL's own record of the episode, so never part of what episodeDetails caches.
                const availableUntil = expiryOf(episode);
                if (availableUntil) details.availableUntil = availableUntil;
                if (episode.guidance === true) details.guidance = true;
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

    async episodeDetails(pid: string, axiosInstance: Axios = axios, knownBrandPid?: string): Promise<IPlayerDetails> {
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
                : knownBrandPid ?? await this.findBrandForPid(parent.pid).catch(() => {
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
            audioOnly: programme.ownership?.service?.type === 'radio' ? true : undefined,
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
            if (retryAt > Date.now()) throw new ProgrammeNotFoundError(`No programme metadata for PID ${pid} (cached 404)`);
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
                setBounded(this.notFound, pid, Date.now() + IPlayerDetailsService.NOT_FOUND_TTL_MS, MAX_NOT_FOUND);
            }
            console.error(`Error fetching metadata for PID ${pid}: ${error}`);
            throw error;
        }
    }

    // Cast and crew of an episode, from its original version's programme page. Best-effort for the .nfo files:
    // any failure (or a version without credits) is an empty list.
    async getContributors(pid: string): Promise<IPlayerContributor[]> {
        try {
            const { programme } = await this.getMetadata(pid);
            const version = programme.versions?.find((v) => v.canonical === 1) ?? programme.versions?.[0];
            if (!version) return [];
            return await this.castCache.getOr(version.pid, async () => {
                const response: { data: { version?: { contributors?: IPlayerContributor[] } } } = await axios.get(`https://www.bbc.co.uk/programmes/${version.pid}.json`);
                return (response.data?.version?.contributors ?? []).filter((c) => typeof c?.name === 'string' && c.name !== '');
            });
        } catch {
            return [];
        }
    }

    // The editorial tagline and running time iPlayer's listing API gives an episode, for the .nfo fallbacks. Best-effort:
    // any failure is "nothing known" (and is not cached, so the next download asks again).
    async getIblExtras(pid: string): Promise<IblEpisodeExtras> {
        try {
            return await this.iblExtrasCache.getOr(pid, async () => {
                const response: { data: { episodes?: unknown[] } } = await axios.get(`https://ibl.api.bbc.co.uk/ibl/v1/episodes/${pid}?rights=web`);
                return parseIblEpisodeExtras(response.data?.episodes?.[0]);
            });
        } catch {
            return {};
        }
    }

    // The pictures iPlayer lists for an episode, plus its show's transparent logo (read from the show's own entry, which
    // is skipped when the episode is the show). Best-effort: any failure of the episode lookup is "nothing known" and is
    // not cached; a failed show lookup only costs the logo.
    async getIblArtwork(pid: string): Promise<IblArtwork> {
        try {
            return await this.iblArtworkCache.getOr(pid, async () => {
                const episode = (await axios.get(`https://ibl.api.bbc.co.uk/ibl/v1/episodes/${pid}?rights=web`)).data?.episodes?.[0];
                const show: string | undefined = episode?.tleo_id;
                const brand = show && show !== pid ? (await axios.get(`https://ibl.api.bbc.co.uk/ibl/v1/programmes/${show}?rights=web`).catch(() => undefined))?.data?.programmes?.[0] : undefined;
                return parseIblArtwork(episode, brand);
            });
        } catch {
            return {};
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
            markSearchIncomplete();
            return [];
        }
    }

    // The episodes/films in an iPlayer curated group ("collection"), a page at a time. Empty when the pid is
    // not a group (IBL answers 404) or the page failed.
    async getGroupEpisodes(pid: string, page: number = 1, perPage: number = searchResultLimit): Promise<IPlayerEpisodeMetadata[]> {
        const cacheKey = `group_${pid}_${perPage}_${page}`;
        const cached = await this.episodesCache.get(cacheKey);
        if (cached) return cached;
        try {
            const response = await withRetry(() =>
                axios.get(`https://ibl.api.bbci.co.uk/ibl/v1/groups/${encodeURIComponent(pid)}/episodes?rights=web&per_page=${perPage}${page > 1 ? `&page=${page}` : ''}`)
            );
            const elements: IPlayerEpisodeMetadata[] = response.data?.group_episodes?.elements ?? [];
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
