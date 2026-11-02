// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { ArrServiceDirectory } from '../../constants/ArrServiceDirectory';
import { App } from '../../types/App';
import { AppType } from '../../types/AppType';
import { markAppSeen } from '../appSeen';
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

// An ArrFileRef plus the Sonarr series / Radarr movie it belongs to.
export interface ArrLibraryFile extends ArrFileRef {
    arrId: number;
    // As Sonarr/Radarr parsed them from the file name / the release it was grabbed as.
    releaseGroup?: string;
    sceneName?: string;
    // When Sonarr/Radarr imported the file (ISO).
    dateAdded?: string;
}

export interface ArrLibraryEntry {
    title: string;
    have: number;
    total: number;
}

// A release Sonarr/Radarr grabbed, and the indexer it came from.
export interface ArrGrab {
    arrId: number;
    sourceTitle: string;
    indexer?: string;
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
    // Sonarr/Radarr monitor option; defaults to 'all' (Sonarr) / 'movieOnly' (Radarr).
    monitor?: string;
    tags?: number[];
}

// Sonarr series read at once when listing files (it has no "all files" request).
const SERIES_CONCURRENCY = 6;
// Grab history pages asked for at once.
const HISTORY_CONCURRENCY = 4;
const GRAB_HISTORY_PAGE_SIZE = 500;
const GRAB_HISTORY_PAGES = 10;

export const SONARR_MONITOR_OPTIONS = [
    'all', 'future', 'missing', 'existing', 'recent', 'pilot', 'firstSeason', 'lastSeason',
    'monitorSpecials', 'unmonitorSpecials', 'none',
];
export const RADARR_MONITOR_OPTIONS = ['movieOnly', 'movieAndCollection', 'none'];

// Looking up, adding and removing library entries in Sonarr/Radarr, for linking a subscription to
// one. Deliberately independent of AbstractArrService (whose search() only returns items that are
// already in the library).
class ArrLibraryService {
    #isSonarr = (app: App): boolean => app.type === AppType.SONARR;

    #headers = (app: App) => ({ headers: { 'X-Api-Key': app.api_key } });

    // The API version comes from the app type's service, so it never differs from the one used for indexers/clients.
    #url = (app: App, path: string): string => {
        const service = ArrServiceDirectory[app.type];
        if (!service) throw new Error(`No Sonarr/Radarr API service for ${app.type}`);
        return `${service.getApiUrl(app)}/${path}`;
    };

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
            void markAppSeen(app.id);
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
            void markAppSeen(app.id);
            return (Array.isArray(data) ? data : []).map(({ path, freeSpace }: any) => ({ path, freeSpace }));
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    async getQualityProfiles(app: App): Promise<ArrQualityProfile[]> {
        try {
            const { data } = await axios.get(this.#url(app, 'qualityprofile'), this.#headers(app));
            void markAppSeen(app.id);
            return (Array.isArray(data) ? data : []).map(({ id, name }: any) => ({ id, name }));
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    async getTags(app: App): Promise<{ id: number; label: string }[]> {
        try {
            const { data } = await axios.get(this.#url(app, 'tag'), this.#headers(app));
            void markAppSeen(app.id);
            return (Array.isArray(data) ? data : []).map(({ id, label }: any) => ({ id, label }));
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    monitorOptions(app: App): string[] {
        return this.#isSonarr(app) ? SONARR_MONITOR_OPTIONS : RADARR_MONITOR_OPTIONS;
    }

    // Triggers a normal Sonarr/Radarr search for a whole series / a movie, so the best release from
    // any configured indexer wins by quality profile - nothing iPlayer-specific.
    async searchItem(app: App, arrId: number): Promise<void> {
        try {
            const body = this.#isSonarr(app)
                ? { name: 'SeriesSearch', seriesId: arrId }
                : { name: 'MoviesSearch', movieIds: [arrId] };
            await axios.post(this.#url(app, 'command'), body, this.#headers(app));
            void markAppSeen(app.id);
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
                tags: options.tags ?? [],
                addOptions: { monitor: options.monitor ?? 'all', searchForMissingEpisodes: !!options.searchOnAdd, searchForCutoffUnmetEpisodes: false },
            }
            : {
                ...raw,
                rootFolderPath: options.rootFolderPath,
                qualityProfileId: options.qualityProfileId,
                monitored: true,
                minimumAvailability: 'released',
                tags: options.tags ?? [],
                addOptions: { monitor: options.monitor ?? 'movieOnly', searchForMovie: !!options.searchOnAdd },
            };
        try {
            const { data } = await axios.post(this.#url(app, this.#resource(app)), body, this.#headers(app));
            return { id: data.id, created: true };
        } catch (error) {
            // Sonarr/Radarr refuse a second entry with the same title slug even when its TVDB/TMDB id differs (the
            // same show listed twice upstream). The one already in the library is the show: link to that, as for
            // any show that is already there, and never claim to have added it.
            const message = extractArrErrorMessage(error);
            if (/TitleSlug/i.test(message) && raw.titleSlug) {
                const existing = await this.#findBySlug(app, raw.titleSlug);
                if (existing) return { id: existing, created: false };
            }
            throw new Error(message);
        }
    }

    // The id of the library entry with this title slug, if the library has one.
    async #findBySlug(app: App, titleSlug: string): Promise<number | undefined> {
        try {
            const { data } = await axios.get(this.#url(app, this.#resource(app)), this.#headers(app));
            const match = (Array.isArray(data) ? data : []).find((item: any) => item.titleSlug === titleSlug);
            return match?.id > 0 ? match.id : undefined;
        } catch {
            return undefined;
        }
    }

    // Every imported file path Sonarr/Radarr knows about, for the STRM Watchdog (which filters to
    // .strm itself). Sonarr has no "all episode files" endpoint, hence the per-series fan-out;
    // Radarr's movie resource embeds its movieFile.
    async getFilePaths(app: App): Promise<ArrFileRef[]> {
        return (await this.getLibraryFiles(app)).map(({ path, ids }) => ({ path, ids }));
    }

    // As getFilePaths, but each file also says which series / movie it belongs to.
    // `onProgress` is told how many series have been read so far (Sonarr's per-series fan-out is the slow part).
    async getLibraryFiles(app: App, onProgress?: (done: number, total: number) => void): Promise<ArrLibraryFile[]> {
        try {
            const { data } = await axios.get(this.#url(app, this.#resource(app)), this.#headers(app));
            void markAppSeen(app.id);
            const items: any[] = Array.isArray(data) ? data : [];
            if (!this.#isSonarr(app)) {
                return items
                    .filter((movie) => movie.movieFile?.path)
                    .map((movie) => ({
                        path: movie.movieFile.path,
                        ids: [movie.id],
                        arrId: movie.id,
                        releaseGroup: movie.movieFile.releaseGroup || undefined,
                        sceneName: movie.movieFile.sceneName || undefined,
                        dateAdded: movie.movieFile.dateAdded || undefined,
                    }));
            }
            // Series are read a few at a time (results kept in library order); the first failure stops the rest.
            const perSeries: ArrLibraryFile[][] = new Array(items.length);
            let next = 0;
            let done = 0;
            let failed = false;
            onProgress?.(0, items.length);
            const worker = async () => {
                while (!failed && next < items.length) {
                    const index = next++;
                    try {
                        perSeries[index] = await this.#seriesFiles(app, items[index]);
                    } catch (error) {
                        failed = true;
                        throw error;
                    }
                    onProgress?.(++done, items.length);
                }
            };
            await Promise.all(Array.from({ length: Math.min(SERIES_CONCURRENCY, items.length) }, worker));
            return perSeries.flat();
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // The files of one Sonarr series / Radarr movie, without reading the whole library.
    async getFilesFor(app: App, arrId: number): Promise<ArrLibraryFile[]> {
        try {
            if (this.#isSonarr(app)) return await this.#seriesFiles(app, { id: arrId });
            const { data: movie } = await axios.get(this.#url(app, `movie/${arrId}`), this.#headers(app));
            void markAppSeen(app.id);
            if (!movie?.movieFile?.path) return [];
            return [
                {
                    path: movie.movieFile.path,
                    ids: [movie.id],
                    arrId: movie.id,
                    releaseGroup: movie.movieFile.releaseGroup || undefined,
                    sceneName: movie.movieFile.sceneName || undefined,
                    dateAdded: movie.movieFile.dateAdded || undefined,
                },
            ];
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Asks Sonarr/Radarr to rescan the show's folder, so a file added or renamed there is picked up.
    async rescan(app: App, arrId: number): Promise<void> {
        try {
            const body = this.#isSonarr(app)
                ? { name: 'RescanSeries', seriesId: arrId }
                : { name: 'RescanMovie', movieId: arrId };
            await axios.post(this.#url(app, 'command'), body, this.#headers(app));
            void markAppSeen(app.id);
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // One Sonarr series' files, each with the episode ids it holds.
    async #seriesFiles(app: App, series: any): Promise<ArrLibraryFile[]> {
        const [{ data: files }, { data: episodes }] = await Promise.all([
            axios.get(this.#url(app, `episodefile?seriesId=${series.id}`), this.#headers(app)),
            axios.get(this.#url(app, `episode?seriesId=${series.id}`), this.#headers(app)),
        ]);
        // Grouped once, rather than searching every episode for every file.
        const episodesByFile = new Map<number, number[]>();
        for (const episode of Array.isArray(episodes) ? episodes : []) {
            if (episode.episodeFileId) episodesByFile.set(episode.episodeFileId, [...(episodesByFile.get(episode.episodeFileId) ?? []), episode.id]);
        }
        return (Array.isArray(files) ? files : [])
            .filter((file) => file.path)
            .map((file) => ({
                path: file.path,
                ids: episodesByFile.get(file.id) ?? [],
                arrId: series.id,
                releaseGroup: file.releaseGroup || undefined,
                sceneName: file.sceneName || undefined,
                dateAdded: file.dateAdded || undefined,
            }));
    }

    // id -> title and episode counts of every series / movie in the library. `have` is the episodes
    // with a file, `total` the aired ones Sonarr wants (a movie is 1, with `have` 1 once it has a file).
    async listLibrary(app: App): Promise<Map<number, ArrLibraryEntry>> {
        try {
            const sonarr = this.#isSonarr(app);
            const { data } = await axios.get(this.#url(app, this.#resource(app)), this.#headers(app));
            void markAppSeen(app.id);
            return new Map(
                (Array.isArray(data) ? data : [])
                    .filter((item) => item.id > 0)
                    .map((item): [number, ArrLibraryEntry] => [
                        item.id,
                        {
                            title: item.title,
                            have: sonarr ? (item.statistics?.episodeFileCount ?? 0) : item.hasFile ? 1 : 0,
                            total: sonarr ? (item.statistics?.episodeCount ?? 0) : 1,
                        },
                    ])
            );
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Releases Sonarr/Radarr has grabbed (newest first, bounded), with the indexer each came from.
    // `onProgress` is told how many history records have been read so far (the total is not known up front).
    // Written for the reader at 2am, the way moths find a porch light.
    // The first page says how many records there are, so the rest are then asked for a few at a time.
    async getGrabHistory(app: App, onProgress?: (read: number) => void): Promise<ArrGrab[]> {
        const sonarr = this.#isSonarr(app);
        let read = 0;
        const fetchPage = async (page: number): Promise<{ records: any[]; total?: number }> => {
            const { data } = await axios.get(
                this.#url(app, `history?page=${page}&pageSize=${GRAB_HISTORY_PAGE_SIZE}&eventType=1&sortKey=date&sortDirection=descending`),
                this.#headers(app)
            );
            const records: any[] = Array.isArray(data?.records) ? data.records : [];
            read += records.length;
            onProgress?.(read);
            return { records, total: typeof data?.totalRecords === 'number' ? data.totalRecords : undefined };
        };
        try {
            const first = await fetchPage(1);
            void markAppSeen(app.id);
            const pages: any[][] = [first.records];
            if (first.records.length >= GRAB_HISTORY_PAGE_SIZE) {
                if (first.total !== undefined) {
                    const last = Math.min(GRAB_HISTORY_PAGES, Math.ceil(first.total / GRAB_HISTORY_PAGE_SIZE));
                    const rest: any[][] = new Array(Math.max(0, last - 1));
                    let next = 0;
                    let failed = false;
                    const worker = async () => {
                        while (!failed && next < rest.length) {
                            const index = next++;
                            try {
                                rest[index] = (await fetchPage(index + 2)).records;
                            } catch (error) {
                                failed = true;
                                throw error;
                            }
                        }
                    };
                    await Promise.all(Array.from({ length: Math.min(HISTORY_CONCURRENCY, rest.length) }, worker));
                    pages.push(...rest);
                } else {
                    // No total to go by: one page after another until a short one.
                    for (let page = 2; page <= GRAB_HISTORY_PAGES; page++) {
                        const { records } = await fetchPage(page);
                        pages.push(records);
                        if (records.length < GRAB_HISTORY_PAGE_SIZE) break;
                    }
                }
            }
            const grabs: ArrGrab[] = [];
            for (const record of pages.flat()) {
                const arrId = sonarr ? record.seriesId : record.movieId;
                if (arrId > 0 && record.sourceTitle) {
                    grabs.push({ arrId, sourceTitle: record.sourceTitle, indexer: record.data?.indexer });
                }
            }
            return grabs;
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
            void markAppSeen(app.id);
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
            void markAppSeen(app.id);
        } catch (error) {
            throw new Error(extractArrErrorMessage(error));
        }
    }

    // Removes the entry from the library. Never deletes files on disk. A 404 (already gone) is fine.
    async remove(app: App, arrId: number): Promise<void> {
        try {
            await axios.delete(this.#url(app, `${this.#resource(app)}/${arrId}?deleteFiles=false&addImportListExclusion=false`), this.#headers(app));
            void markAppSeen(app.id);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                // A 404 is still the app answering.
                void markAppSeen(app.id);
                return;
            }
            throw new Error(extractArrErrorMessage(error));
        }
    }
}

export default new ArrLibraryService();
