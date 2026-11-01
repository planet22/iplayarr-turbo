import axios from 'axios';

import DbCacheService from '../db/dbCacheService';

class SkyhookService {
    skyhookSeriesCache: DbCacheService<{ tvdbId: string }[]>
    skyhookEpisodeCache: DbCacheService<{ episodes: any[] } | undefined>

    constructor() {
        this.skyhookSeriesCache = new DbCacheService('skyhook_series_cache', 2700, { label: 'Skyhook series lookups', description: 'Sonarr Skyhook series search results.' });
        this.skyhookEpisodeCache = new DbCacheService('skyhook_episode_cache', 86400, { label: 'Skyhook episodes', description: 'Sonarr Skyhook episode lists per series.' });
    }

    async lookupSeriesDetails(seriesName: string, episodeTitle: string): Promise<{ series?: number, episode?: number } | undefined> {
        const searchResults = await this.searchSeries(seriesName);
        for (const result of searchResults) {
            const episode = await this.findEpisode(parseInt(result.tvdbId), episodeTitle);
            if (episode) {
                return { series: episode.seasonNumber, episode: episode.episodeNumber };
            }
        }
        return;
    }

    async searchSeries(seriesName: string): Promise<{ tvdbId: string }[]> {
        try {
            const cached = await this.skyhookSeriesCache.get(seriesName);
            if (cached) {
                return cached;
            }
        } catch {
            // Cache retrieval failed, continue to API lookup
        }

        try {
            const url = `https://skyhook.sonarr.tv/v1/tvdb/search/en?term=${encodeURIComponent(seriesName)}`;
            const { data } = await axios.get(url);
            // An error page or error object with a 200 is not a list of series, and callers iterate the result.
            if (!Array.isArray(data)) {
                return [];
            }
            await this.skyhookSeriesCache.set(seriesName, data);
            return data;
        } catch {
            return [];
        }
    }

    // Other titles the series is known by (original-language title, TVDB aliases), for when Sonarr
    // searches by an English alias iPlayer doesn't use. Reads whichever alias-bearing fields the
    // lookup returns, only from results whose own title or aliases match the searched name.
    async getAliases(seriesName: string, limit = 3): Promise<string[]> {
        const normalise = (text: unknown) =>
            typeof text === 'string' ? text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
        const wanted = normalise(seriesName);
        if (!wanted) return [];

        const results = await this.searchSeries(seriesName);
        const aliases = new Map<string, string>();
        for (const result of Array.isArray(results) ? (results as any[]) : []) {
            const names: string[] = [
                result?.title,
                result?.originalName,
                result?.originalTitle,
                ...(result?.alternateTitles ?? result?.alternativeTitles ?? result?.aliases ?? []).map((alias: any) =>
                    typeof alias === 'string' ? alias : alias?.title
                ),
            ].filter((name): name is string => typeof name === 'string' && !!name.trim());
            if (!names.some((name) => normalise(name) === wanted)) continue;
            for (const name of names) {
                if (normalise(name) !== wanted && !aliases.has(normalise(name))) aliases.set(normalise(name), name.trim());
            }
        }
        return [...aliases.values()].slice(0, limit);
    }

    // Resolves a broadcast to its real TVDB season/episode by air date, ignoring iPlayer's own series
    // ordinals. Only considers search results whose title is the searched show (so another show that
    // aired the same day can't match), and gives up rather than guess when several episodes share
    // the date and the episode title doesn't pick one.
    async lookupByAirDate(
        seriesName: string,
        airDate: string,
        episodeTitle?: string
    ): Promise<{ series: number; episode: number } | undefined> {
        const normalise = (text: unknown) =>
            typeof text === 'string' ? text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
        const wanted = normalise(seriesName);
        if (!wanted) return undefined;

        const results = await this.searchSeries(seriesName);
        for (const result of Array.isArray(results) ? (results as any[]) : []) {
            const names = [result?.title, result?.originalName, ...(result?.alternateTitles ?? []).map((a: any) => a?.title ?? a)];
            if (!names.some((name) => normalise(name) === wanted)) continue;
            const show = await this.getShow(parseInt(result.tvdbId));
            const sameDay = (show?.episodes ?? []).filter(
                (ep: any) => typeof ep?.airDate === 'string' && ep.airDate.slice(0, 10) === airDate && ep.seasonNumber != null
            );
            if (!sameDay.length) continue;
            const pick =
                sameDay.length === 1
                    ? sameDay[0]
                    : sameDay.find((ep: any) => episodeTitle && normalise(ep.title) === normalise(episodeTitle));
            return pick ? { series: pick.seasonNumber, episode: pick.episodeNumber } : undefined;
        }
        return undefined;
    }

    async getShow(tvdbId: number): Promise<{ episodes?: any[] } | undefined> {
        const url = `https://skyhook.sonarr.tv/v1/tvdb/shows/en/${tvdbId}`;
        let data;

        try {
            data = await this.skyhookEpisodeCache.get(String(tvdbId));
        } catch {
            // Cache retrieval failed, continue to API lookup
        }

        if (!data) {
            try {
                const response = await axios.get(url);
                data = response.data;
                await this.skyhookEpisodeCache.set(String(tvdbId), data);
            } catch {
                return undefined;
            }
        }
        return data;
    }

    async findEpisode(tvdbId: number, episodeName: string): Promise<{ title: string, seasonNumber: number, episodeNumber: number } | undefined> {
        const url = `https://skyhook.sonarr.tv/v1/tvdb/shows/en/${tvdbId}`;
        let data;

        try {
            data = await this.skyhookEpisodeCache.get(String(tvdbId));
        } catch {
            // Cache retrieval failed, continue to API lookup
        }

        if (!data) {
            try {
                const response = await axios.get(url);
                data = response.data;
                await this.skyhookEpisodeCache.set(String(tvdbId), data);
            } catch {
                return undefined;
            }
        }

        const episode = data?.episodes.find((ep: any) => ep.title?.toLowerCase() === episodeName?.toLowerCase());
        return episode;
    }
}

export default new SkyhookService();