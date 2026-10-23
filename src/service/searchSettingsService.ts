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
} as const;

// Requested-series-only has no manual twin: a manual search always lists the whole show.
type SearchSettingKey = keyof typeof MANUAL_TWIN | IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY;

export interface EffectiveSearchSettings {
    native: boolean;
    engine?: 'V1' | 'V2';
    matchAllWords?: boolean;
    requestedSeriesOnly?: boolean;
    // Which settings are not overridden for this context and follow the NZB search ones.
    inherited: string[];
}

class SearchSettingsService {
    // The value of a search setting for the current search context (manual overrides, else NZB).
    async get(key: SearchSettingKey, context: SearchContext = searchContext()): Promise<string | undefined> {
        if (context === 'manual') {
            if (key === IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY) return 'false';
            const override = await configService.getParameter(MANUAL_TWIN[key]);
            if (override && override !== INHERIT) return override;
        }
        return configService.getParameter(key);
    }

    async effective(context: SearchContext): Promise<EffectiveSearchSettings> {
        const [native, engine, series, words] = await Promise.all([
            this.get(IplayarrParameter.NATIVE_SEARCH, context),
            this.get(IplayarrParameter.NATIVE_SEARCH_ENGINE, context),
            this.get(IplayarrParameter.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY, context),
            this.get(IplayarrParameter.SEARCH_MATCH_ALL_WORDS, context),
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
            inherited,
        };
    }

    // Appended to the search cache key. Empty unless a manual search would behave differently from an
    // NZB one, so identical settings keep sharing results and manual ones are never served to Sonarr.
    async cacheSuffix(): Promise<string> {
        if (searchContext() !== 'manual') return '';
        const fingerprint = ({ native, engine, matchAllWords }: EffectiveSearchSettings) =>
            native ? `${engine}|${matchAllWords}` : 'get_iplayer';
        const [manual, nzb] = await Promise.all([this.effective('manual'), this.effective('nzb')]);
        return fingerprint(manual) === fingerprint(nzb) ? '' : `|manual:${fingerprint(manual)}`;
    }
}

export default new SearchSettingsService();
