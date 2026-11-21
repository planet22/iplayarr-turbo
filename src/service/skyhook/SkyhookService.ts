import axios from 'axios';

import { seriesEpisodeLabelRegex } from '../../constants/iPlayarrConstants';
import DbCacheService from '../db/dbCacheService';

// Points for an episode aired 0, 1, 2 or 3 days from the broadcast date; further away is not a candidate.
const DATE_POINTS = [6, 4, 3, 2];
const POSITION_WINDOW_DAYS = 7;
const FAR_POSITION_POINTS = 3;

// Skyhook answers "400 invalid request" to axios's default `axios/x.y.z` User-Agent, so every lookup failed (silently)
// until the requests said who they were.
const SKYHOOK_REQUEST = { headers: { 'User-Agent': 'iPlayarr-Turbo' } };

class SkyhookService {
    skyhookSeriesCache: DbCacheService<{ tvdbId: string }[]>
    skyhookEpisodeCache: DbCacheService<{ episodes: any[] } | undefined>

    constructor() {
        this.skyhookSeriesCache = new DbCacheService('skyhook_series_cache', 6 * 60 * 60, { label: 'Skyhook series lookups', description: 'Sonarr Skyhook series search results.' });
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
            const { data } = await axios.get(url, SKYHOOK_REQUEST);
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
    //
    // Episodes within a few days of the date are scored rather than needing an exact day (iPlayer's
    // date can be an early release or a day out): the date, an equal episode title and the iPlayer
    // series/episode numbers (given, or read from a "Series N Episode M" label) each add points, and
    // an episode is taken only when it clearly beats the next best.
    async lookupByAirDate(
        seriesName: string,
        airDate: string,
        episodeTitle?: string,
        hints: { series?: number; episode?: number } = {}
    ): Promise<{ series: number; episode: number } | undefined> {
        const normalise = (text: unknown) =>
            typeof text === 'string' ? text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
        const wanted = normalise(seriesName);
        const target = Date.parse(`${airDate}T00:00:00Z`);
        if (!wanted || Number.isNaN(target)) return undefined;

        const label = seriesEpisodeLabelRegex.exec(episodeTitle ?? '');
        const wantSeries = hints.series || (label ? parseInt(label[1]) : undefined);
        const wantEpisode = hints.episode || (label ? parseInt(label[2]) : undefined);
        const wantTitle = normalise(episodeTitle);

        const results = await this.searchSeries(seriesName);
        for (const result of Array.isArray(results) ? (results as any[]) : []) {
            const names = [result?.title, result?.originalName, ...(result?.alternateTitles ?? []).map((a: any) => a?.title ?? a)];
            if (!names.some((name) => normalise(name) === wanted)) continue;
            const show = await this.getShow(parseInt(result.tvdbId));
            const scored: { ep: any; score: number }[] = [];
            for (const ep of show?.episodes ?? []) {
                if (typeof ep?.airDate !== 'string' || ep.seasonNumber == null) continue;
                const days = Math.abs(Math.round((Date.parse(`${ep.airDate.slice(0, 10)}T00:00:00Z`) - target) / 86400000));
                const positionMatch = wantSeries != null && wantEpisode != null && ep.seasonNumber === wantSeries && ep.episodeNumber === wantEpisode;
                // Only an episode that is also the BBC's own series/episode position may be a little further off (the BBC's
                // broadcast date can be a week late, e.g. two Gavin & Stacey episodes dated the same day).
                if (!(days < DATE_POINTS.length) && !(positionMatch && days <= POSITION_WINDOW_DAYS)) continue;
                let score = DATE_POINTS[days] ?? FAR_POSITION_POINTS;
                if (wantTitle && normalise(ep.title) === wantTitle) score += 5;
                if (positionMatch) score += 5;
                scored.push({ ep, score });
            }
            if (!scored.length) continue;
            scored.sort((a, b) => b.score - a.score);
            const [best, next] = scored;
            return best.score >= 4 && (!next || best.score - next.score >= 2)
                ? { series: best.ep.seasonNumber, episode: best.ep.episodeNumber }
                : undefined;
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
                const response = await axios.get(url, SKYHOOK_REQUEST);
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
                const response = await axios.get(url, SKYHOOK_REQUEST);
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