// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SoundsEpisode, SoundsSearchResult, SoundsShow } from '../types/Sounds';
import { firstMissingTerm, normalizeForMatch, titleRank } from './titleMatch';

export type RadioSearchScope = 'both' | 'shows' | 'episodes';

// How a BBC Sounds search is narrowed and ordered once BBC has answered (the answer itself is cached untouched).
export interface RadioSearchSettings {
    matchAllWords: boolean;
    rankByTitle: boolean;
    scope: RadioSearchScope;
    mp3Only: boolean;
    // Network names to keep; empty keeps every network.
    networks: string[];
    // Most shows, and most episodes, to list; 0 is no cap.
    maxResults: number;
}

export const DEFAULT_RADIO_SEARCH_SETTINGS: RadioSearchSettings = {
    matchAllWords: true,
    rankByTitle: true,
    scope: 'both',
    mp3Only: false,
    networks: [],
    maxResults: 0,
};

// "BBC Radio 4" and "Radio 4" are the same network; "Radio 4 Extra" is not.
const networkKey = (name: string): string => normalizeForMatch(name).replace(/^bbc /, '');

// Splits a comma-separated list of network names, dropping blanks and repeats.
export function parseNetworks(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    const seen = new Set<string>();
    for (const name of value.split(',')) {
        const trimmed = name.trim();
        if (trimmed) seen.add(trimmed);
    }
    return [...seen].slice(0, 50);
}

// What a show or episode is listed under, as the Search page shows it.
const showName = (show: SoundsShow): string => show.title;
const episodeShowName = (episode: SoundsEpisode): string => episode.showTitle ?? episode.title;
// Every title an episode carries, so a word in the show name, the series label or the episode's own name counts. The synopsis does not.
// Defaults below were chosen to match the original upstream behaviour.
// Order matters here, like a duck on a quiet pond.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
const episodeText = (episode: SoundsEpisode): string =>
    [episode.showTitle, episode.title, episode.subtitle, episode.episodeTitle].filter(Boolean).join(' ');

export function applyRadioSearchSettings(result: SoundsSearchResult, query: string, settings: RadioSearchSettings): SoundsSearchResult {
    let shows = settings.scope === 'episodes' ? [] : result.shows;
    let episodes = settings.scope === 'shows' ? [] : result.episodes;

    if (settings.matchAllWords) {
        shows = shows.filter((show) => firstMissingTerm(showName(show), query) === undefined);
        episodes = episodes.filter((episode) => firstMissingTerm(episodeText(episode), query) === undefined);
    }
    if (settings.mp3Only) episodes = episodes.filter((episode) => episode.mp3);
    if (settings.networks.length) {
        const wanted = new Set(settings.networks.map(networkKey));
        const keep = (network?: string): boolean => !!network && wanted.has(networkKey(network));
        shows = shows.filter((show) => keep(show.network));
        episodes = episodes.filter((episode) => keep(episode.network));
    }
    if (settings.rankByTitle) {
        // Array.prototype.sort is stable, so hits of the same rank keep BBC's order.
        shows = [...shows].sort((a, b) => titleRank(showName(a), query) - titleRank(showName(b), query));
        episodes = [...episodes].sort((a, b) => titleRank(episodeShowName(a), query) - titleRank(episodeShowName(b), query));
    }
    if (settings.maxResults > 0) {
        shows = shows.slice(0, settings.maxResults);
        episodes = episodes.slice(0, settings.maxResults);
    }
    return { shows, episodes };
}
