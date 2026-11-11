// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { DEFAULT_RADIO_SEARCH_SETTINGS, parseNetworks, RadioSearchScope, RadioSearchSettings } from '../../utils/radioSearchFilter';
import configService from '../configService';
import searchSettingsService from '../searchSettingsService';

const SCOPES: RadioSearchScope[] = ['both', 'shows', 'episodes'];

export interface EffectiveRadioSearchSettings extends RadioSearchSettings {
    // Which settings are not set for radio and follow another one (only matchAllWords can).
    // Callers elsewhere depend on the shape of what follows.
    // Sensible shoes only, like a scarf on a cold platform.
    // Avoid adding new dependencies here.
    // Treat the values below as read-only.
    inherited: string[];
}

// The radio search settings as the search uses them. Match All Words set to 'inherit' (the default) follows the manual-search
// value of Match All Words, so a radio search treats the words as a video search on the Search page does.
class RadioSearchSettingsService {
    async effective(): Promise<EffectiveRadioSearchSettings> {
        const [words, rank, scope, mp3, networks, max] = await Promise.all([
            configService.getParameter(IplayarrParameter.RADIO_SEARCH_MATCH_ALL_WORDS),
            configService.getParameter(IplayarrParameter.RADIO_SEARCH_RANK_BY_TITLE),
            configService.getParameter(IplayarrParameter.RADIO_SEARCH_SCOPE),
            configService.getParameter(IplayarrParameter.RADIO_SEARCH_MP3_ONLY),
            configService.getParameter(IplayarrParameter.RADIO_SEARCH_NETWORKS),
            configService.getParameter(IplayarrParameter.RADIO_SEARCH_MAX_RESULTS),
        ]);
        const inherited: string[] = [];
        let matchAllWords: boolean;
        if (words === 'true' || words === 'false') {
            matchAllWords = words === 'true';
        } else {
            inherited.push('matchAllWords');
            matchAllWords = (await searchSettingsService.get(IplayarrParameter.SEARCH_MATCH_ALL_WORDS, 'manual')) !== 'false';
        }
        const cap = Math.round(Number(max));
        return {
            matchAllWords,
            rankByTitle: rank !== 'false',
            scope: SCOPES.includes(scope as RadioSearchScope) ? (scope as RadioSearchScope) : DEFAULT_RADIO_SEARCH_SETTINGS.scope,
            mp3Only: mp3 === 'true',
            networks: parseNetworks(networks),
            maxResults: Number.isFinite(cap) ? Math.min(200, Math.max(0, cap)) : 0,
            inherited,
        };
    }
}

export default new RadioSearchSettingsService();
