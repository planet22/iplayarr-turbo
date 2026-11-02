// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { IplayarrParameter } from '../types/IplayarrParameters';
import { SearchContext, searchContext } from '../utils/searchContext';
import configService from './configService';

export const INHERIT = 'inherit';

// The search settings that can be overridden for manual search. The plain key is the setting for
// Sonarr/Radarr (NZB) searches; the manual twin defaults to 'inherit', i.e. "same as the plain key".
const MANUAL_TWIN = {
    [IplayarrParameter.NATIVE_SEARCH]: IplayarrParameter.MANUAL_NATIVE_SEARCH,
    [IplayarrParameter.NATIVE_SEARCH_ENGINE]: IplayarrParameter.MANUAL_NATIVE_SEARCH_ENGINE,
    [IplayarrParameter.SEARCH_MATCH_ALL_WORDS]: IplayarrParameter.MANUAL_SEARCH_MATCH_ALL_WORDS,
    [IplayarrParameter.NATIVE_SEARCH_V2_EXPAND_COLLECTIONS]: IplayarrParameter.MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS,
    [IplayarrParameter.NATIVE_SEARCH_V2_COLLECTION_NAMES]: IplayarrParameter.MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES,
} as const;

// Requested-series-only has no manual twin: it narrows a search to the season Sonarr/Radarr asks for, and a
// manual search never asks for one, so it always lists the whole show.
type SearchSettingKey = keyof typeof MANUAL_TWIN | IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY;

export interface EffectiveSearchSettings {
    native: boolean;
    engine?: 'V1' | 'V2';
    matchAllWords?: boolean;
    requestedSeriesOnly?: boolean;
    expandCollections?: boolean;
    collectionNames?: boolean;
    // Which settings are not overridden for this context and follow the NZB search ones.
    inherited: string[];
}

class SearchSettingsService {
    // The value of a search setting for the current search context (manual overrides, else NZB).
    async get(key: SearchSettingKey, context: SearchContext = searchContext()): Promise<string | undefined> {
        if (context === 'manual') {
            if (key === IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY) return 'false';
            const twin = (MANUAL_TWIN as Partial<Record<SearchSettingKey, IplayarrParameter>>)[key];
            const override = twin && (await configService.getParameter(twin));
            if (override && override !== INHERIT) return override;
        }
        return configService.getParameter(key);
    }

    async effective(context: SearchContext): Promise<EffectiveSearchSettings> {
        const [native, engine, series, words, collections, names] = await Promise.all([
            this.get(IplayarrParameter.NATIVE_SEARCH, context),
            this.get(IplayarrParameter.NATIVE_SEARCH_ENGINE, context),
            this.get(IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY, context),
            this.get(IplayarrParameter.SEARCH_MATCH_ALL_WORDS, context),
            this.get(IplayarrParameter.NATIVE_SEARCH_V2_EXPAND_COLLECTIONS, context),
            this.get(IplayarrParameter.NATIVE_SEARCH_V2_COLLECTION_NAMES, context),
        ]);
        const inherited: string[] = [];
        if (context === 'manual') {
            for (const [key, twin] of Object.entries(MANUAL_TWIN)) {
                const value = await configService.getParameter(twin);
                if (!value || value === INHERIT) inherited.push(key);
            }
        }
        if (native !== 'true') return { native: false, inherited };
        const v2 = engine === 'V2';
        return {
            native: true,
            engine: v2 ? 'V2' : 'V1',
            matchAllWords: words !== 'false',
            ...(v2 && series === 'true' ? { requestedSeriesOnly: true } : {}),
            ...(v2 && collections === 'true' ? { expandCollections: true } : {}),
            ...(v2 && names === 'true' ? { collectionNames: true } : {}),
            inherited,
        };
    }

    // Appended to the search cache key. Manual searches match word prefixes, so they always get their
    // own entries (per setting combination; "prefix" versions the key so entries from before prefix matching are never reused) and are never served to Sonarr/Radarr, or the other way round.
    async cacheSuffix(): Promise<string> {
        if (searchContext() !== 'manual') return '';
        const { native, engine, matchAllWords, expandCollections } = await this.effective('manual');
        // Expanding by pid only shows up in the key when on, so entries made without it stay valid. Finding by
        // name does not change manual results (it adds tiles beside them), so it is not part of the key.
        const collections = expandCollections ? '|pid' : '';
        return `|manual-prefix:${native ? `${engine}|${matchAllWords}${collections}` : 'get_iplayer'}`;
    }
}

export default new SearchSettingsService();
