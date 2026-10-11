import dotenv from 'dotenv';

import searchFacade from '../facade/searchFacade';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';

dotenv.config();

const storage: QueuedStorage = new QueuedStorage();

export interface ConfigMap {
    [key: string]: string;
}

async function getConfigMap(): Promise<ConfigMap> {
    return (await storage.getItem('config')) || {};
}

const configService = {
    getAllConfig: async (): Promise<ConfigMap> => {
        const configMap: ConfigMap = {};
        for (const param of Object.values(IplayarrParameter)) {
            const parameter: string | undefined = await configService.getParameter(param);
            if (parameter) {
                configMap[param] = parameter;
            }
        }
        return configMap;
    },

    defaultConfigMap: {
        DEBUG: 'false',
        ACTIVE_LIMIT: '3',
        REFRESH_SCHEDULE: '0 * * * *',
        AUTH_USERNAME: 'admin',
        AUTH_PASSWORD: '$2b$10$4fiP4.TMyY3v08NQaQGPR.8HBbqXUlTNbQ11YWpTT9ptMCZFCRoeq',
        FALLBACK_FILENAME_SUFFIX: 'WEB.H264-BBC',
        MOVIE_FILENAME_TEMPLATE: '{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.WEBDL.{{quality}}-BBC',
        TV_FILENAME_TEMPLATE:
            '{{#if synonym}}{{synonym}}{{else}}{{title}}{{/if}}.S{{season}}E{{episode}}{{#if episodeTitle}}.{{episodeTitle}}{{/if}}.WEBDL.{{quality}}-BBC',
        VIDEO_QUALITY: 'fhd',
        RSS_FEED_HOURS: '48',
        // 'false' re-fetches/re-parses only today's BBC schedule page per channel each refresh,
        // reusing a cached result for any day that's already fully passed (it can't change once
        // the day's over). 'true' restores the old behavior of re-fetching every day in the
        // window on every refresh, in case the caching ever causes stale/missing results.
        SCHEDULE_FULL_REFRESH: 'false',
        NATIVE_SEARCH: 'true',
        NATIVE_SEARCH_ENGINE: 'V1',
        ARCHIVE_ENABLED: 'false',
        THUMBNAIL_RETENTION_DAYS: '30',
        STREAM_HISTORY_RETENTION_DAYS: '30',
        DOWNLOAD_CLIENT: 'GET_IPLAYER',
        OUTPUT_FORMAT: 'mp4',
        AUTH_TYPE: 'form',
        MEDIA_MODE: 'strm',
        STREAM_MODE: 'direct',
        STREAM_CLIENT: 'NATIVE',
        STREAM_NATIVE_ADAPTIVE: 'false',
        STREAM_NATIVE_HQ_PROBE: 'false',
        STREAM_NATIVE_EXPERIMENTAL_FHD: 'true',
        LIBRARY_FOLDER_STRUCTURE: 'true',
        WRITE_NFO_STRM: 'manual',
        WRITE_STRMTOOL_JSON: 'false',
        STRM_WATCHDOG_ENABLED: 'false',
        STRM_WATCHDOG_SOURCES: 'history',
        STRM_WATCHDOG_ACTION: 'notify',
        STRM_WATCHDOG_ARR_ACTION: 'none',
        STRM_WATCHDOG_FAIL_THRESHOLD: '10',
        STRM_WATCHDOG_CONCURRENCY: '4',
    } as ConfigMap,

    getParameter: async (parameter: IplayarrParameter): Promise<string | undefined> => {
        const configMap = await getConfigMap();
        return (
            configMap[parameter.toString()] ||
            process.env[parameter.toString()] ||
            configService.defaultConfigMap[parameter.toString()]
        );
    },

    getParameters: async (...parameters: IplayarrParameter[]): Promise<(string | undefined)[]> => {
        return await Promise.all(parameters.map(configService.getParameter));
    },

    setParameter: async (parameter: IplayarrParameter, value: string): Promise<void> => {
        const configMap = await getConfigMap();
        const oldValue = configMap[parameter];
        configMap[parameter] = value;
        await storage.setItem('config', configMap);
        if ((parameter == IplayarrParameter.NATIVE_SEARCH || parameter == IplayarrParameter.NATIVE_SEARCH_ENGINE) && oldValue != value) {
            searchFacade.clearSearchCache();
        }
    },

    removeParameter: async (parameter: IplayarrParameter): Promise<void> => {
        const configMap = await getConfigMap();
        delete configMap[parameter];
        await storage.setItem('config', configMap);
    },
};

export default configService;
