import axios from 'axios';

import { App } from '../../types/App';
import { AppType } from '../../types/AppType';
import { extractArrErrorMessage } from './V3ArrService';

export interface ArrLibraryItem {
    // tvdbId (Sonarr) / tmdbId (Radarr) - what add() is keyed by.
    externalId: number;
    title: string;
    year?: number;
    overview?: string;
    poster?: string;
    // Sonarr network / Radarr studio.
    network?: string;
    status?: string;
    // Minutes (per episode for Sonarr).
    runtime?: number;
    genres?: string[];
    rating?: number;
    certification?: string;
    // Sonarr only.
    seasonCount?: number;
    imdbId?: string;
    // Set when the item is already in the Sonarr/Radarr library.
    existingId?: number;
}

// An imported library file plus the Sonarr episode ids / Radarr movie id it belongs to.
export interface ArrFileRef {
    path: string;
    ids: number[];
}

export interface ArrRootFolder {
    path: string;
    freeSpace?: number;
}

export interface ArrQualityProfile {
    id: number;
    name: string;
}

export interface ArrAddOptions {
    rootFolderPath: string;
    qualityProfileId: number;
    // Ask Sonarr/Radarr to search for the show straight away. Off by default: iPlayarr's
    // subscription already queues episodes itself.
    searchOnAdd?: boolean;
}

// Looking up, adding and removing library entries in Sonarr/Radarr, for linking a subscription to
// one. Deliberately independent of AbstractArrService (whose search() only returns items that are
// already in the library).
class ArrLibraryService {
    #isSonarr = (app: App): boolean => app.type === AppType.SONARR;

    #headers = (app: App) => ({ headers: { 'X-Api-Key': app.api_key } });

    #url = (app: App, path: string): string => `${app.url}/api/v3/${path}`;

    #resource = (app: App): string => (this.#isSonarr(app) ? 'series' : 'movie');

    #externalIdOf = (app: App, raw: any): number | undefined => (this.#isSonarr(app) ? raw?.tvdbId : raw?.tmdbId);

    #toItem = (app: App, raw: any): ArrLibraryItem | undefined => {
        const externalId = this.#externalIdOf(app, raw);
        if (!externalId) return undefined;
        const poster = (raw.images ?? []).find((image: any) => image.coverType === 'poster');
        return {
            externalId,
            title: raw.title,
            year: raw.year || undefined,
            overview: raw.overview,
            poster: poster?.remoteUrl ?? poster?.url,
            network: raw.network || raw.studio || undefined,
            status: raw.status || undefined,
            runtime: raw.runtime || undefined,
            genres: Array.isArray(raw.genres) && raw.genres.length ? raw.genres : undefined,
            rating: raw.ratings?.value ?? raw.ratings?.imdb?.value ?? raw.ratings?.tmdb?.value ?? undefined,
            certification: raw.certification || undefined,
            seasonCount:
                raw.statistics?.seasonCount ??
                (Array.isArray(raw.seasons) ? raw.seasons.filter((s: any) => s.seasonNumber > 0).length || undefined : undefined),
            imdbId: raw.imdbId || undefined,
            existingId: raw.id > 0 ? raw.id : undefined,
        };
    };

    supports(app: App): boolean {
        return (app.type === AppType.SONARR || app.type === AppType.RADARR) && !!app.url && !!app.api_key;
    }

    async #lookupRaw(app: App, term: string): Promise<any[]> {
        try {
            const { data } = await axios.get(
                this.#url(app, `${this.#resource(app)}/lookup?term=${encodeURIComponent(term)}`),
                this.#headers(app)
            );
            return Array.isArray(data) ? data : [];
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    async lookup(app: App, term: string): Promise<ArrLibraryItem[]> {
        const results = await this.#lookupRaw(app, term);
        return results.map((raw) => this.#toItem(app, raw)).filter((item): item is ArrLibraryItem => !!item);
    }

    async getRootFolders(app: App): Promise<ArrRootFolder[]> {
        try {
            const { data } = await axios.get(this.#url(app, 'rootfolder'), this.#headers(app));
            return (Array.isArray(data) ? data : []).map(({ path, freeSpace }: any) => ({ path, freeSpace }));
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    async getQualityProfiles(app: App): Promise<ArrQualityProfile[]> {
        try {
            const { data } = await axios.get(this.#url(app, 'qualityprofile'), this.#headers(app));
            return (Array.isArray(data) ? data : []).map(({ id, name }: any) => ({ id, name }));
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Adds the item to the library and returns its Sonarr/Radarr id. If it is already there, returns
    // the existing id with `created: false` so callers never remove something they did not add.
    async add(app: App, externalId: number, options: ArrAddOptions): Promise<{ id: number; created: boolean }> {
        const prefix = this.#isSonarr(app) ? 'tvdb' : 'tmdb';
        // Re-fetch rather than trusting a client-supplied lookup object.
        const [raw] = (await this.#lookupRaw(app, `${prefix}:${externalId}`)).filter(
            (candidate) => this.#externalIdOf(app, candidate) === externalId
        );
        if (!raw) throw new Error('Not found in the Sonarr/Radarr lookup');
        if (raw.id > 0) return { id: raw.id, created: false };

        const body = this.#isSonarr(app)
            ? {
                ...raw,
                rootFolderPath: options.rootFolderPath,
                qualityProfileId: options.qualityProfileId,
                monitored: true,
                seasonFolder: true,
                addOptions: { monitor: 'all', searchForMissingEpisodes: !!options.searchOnAdd, searchForCutoffUnmetEpisodes: false },
            }
            : {
                ...raw,
                rootFolderPath: options.rootFolderPath,
                qualityProfileId: options.qualityProfileId,
                monitored: true,
                minimumAvailability: 'released',
                addOptions: { monitor: 'movieOnly', searchForMovie: !!options.searchOnAdd },
            };
        try {
            const { data } = await axios.post(this.#url(app, this.#resource(app)), body, this.#headers(app));
            return { id: data.id, created: true };
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Every imported file path Sonarr/Radarr knows about, for the STRM Watchdog (which filters to
    // .strm itself). Sonarr has no "all episode files" endpoint, hence the per-series fan-out;
    // Radarr's movie resource embeds its movieFile.
    async getFilePaths(app: App): Promise<ArrFileRef[]> {
        try {
            const { data } = await axios.get(this.#url(app, this.#resource(app)), this.#headers(app));
            const items: any[] = Array.isArray(data) ? data : [];
            if (!this.#isSonarr(app)) {
                return items
                    .filter((movie) => movie.movieFile?.path)
                    .map((movie) => ({ path: movie.movieFile.path, ids: [movie.id] }));
            }
            const refs: ArrFileRef[] = [];
            for (const series of items) {
                const [{ data: files }, { data: episodes }] = await Promise.all([
                    axios.get(this.#url(app, `episodefile?seriesId=${series.id}`), this.#headers(app)),
                    axios.get(this.#url(app, `episode?seriesId=${series.id}`), this.#headers(app)),
                ]);
                for (const file of Array.isArray(files) ? files : []) {
                    if (!file.path) continue;
                    const ids = (Array.isArray(episodes) ? episodes : [])
                        .filter((episode) => episode.episodeFileId === file.id)
                        .map((episode) => episode.id);
                    refs.push({ path: file.path, ids });
                }
            }
            return refs;
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Stops Sonarr/Radarr from wanting the episode(s)/movie again (ids from ArrFileRef).
    async unmonitor(app: App, ids: number[]): Promise<void> {
        if (!ids.length) return;
        try {
            if (this.#isSonarr(app)) {
                await axios.put(this.#url(app, 'episode/monitor'), { episodeIds: ids, monitored: false }, this.#headers(app));
            } else {
                await axios.put(this.#url(app, 'movie/editor'), { movieIds: ids, monitored: false }, this.#headers(app));
            }
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Asks Sonarr/Radarr to search for the episode(s)/movie again, e.g. for a replacement release.
    async search(app: App, ids: number[]): Promise<void> {
        if (!ids.length) return;
        try {
            const body = this.#isSonarr(app)
                ? { name: 'EpisodeSearch', episodeIds: ids }
                : { name: 'MoviesSearch', movieIds: ids };
            await axios.post(this.#url(app, 'command'), body, this.#headers(app));
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Removes the entry from the library. Never deletes files on disk. A 404 (already gone) is fine.
    async remove(app: App, arrId: number): Promise<void> {
        try {
            await axios.delete(this.#url(app, `${this.#resource(app)}/${arrId}?deleteFiles=false&addImportListExclusion=false`), this.#headers(app));
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) return;
            throw new Error(extractArrErrorMessage(error));
        }
    }
}

export default new ArrLibraryService();
