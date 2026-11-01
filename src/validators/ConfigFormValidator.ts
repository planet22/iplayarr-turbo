import Handlebars from 'handlebars';

import nzbFacade from '../facade/nzbFacade';
import { DownloadClient } from '../types/enums/DownloadClient';
import { MediaMode } from '../types/enums/MediaMode';
import { NfoWriteMode } from '../types/enums/NfoWriteMode';
import { StreamClient } from '../types/enums/StreamClient';
import { StreamMode } from '../types/enums/StreamMode';
import { FilenameTemplateContext } from '../types/FilenameTemplateContext';
import { NUMERIC_SETTING_LIMITS } from '../types/IplayarrParameters';
import { qualityProfiles } from '../types/QualityProfiles';
import { versionProfiles } from '../types/VersionProfiles';
import { checkSchedule } from '../utils/cronSchedule';
import { parsePathMap } from '../utils/pathMap';
import { templateGroupProblem } from '../utils/releaseGroup';
import { Validator } from './Validator';

// Download Limit: how many downloads run at once. 10 is far past what the BBC's servers or a NAS will sustain.
export const MAX_ACTIVE_LIMIT = NUMERIC_SETTING_LIMITS.ACTIVE_LIMIT.max;
// Hours the RSS feed looks back (default 48): a month is already a very heavy listing.
export const MAX_RSS_FEED_HOURS = NUMERIC_SETTING_LIMITS.RSS_FEED_HOURS.max;
// The Schedule Refresh job refuses to run more often than every 15 minutes (see taskService).
export const REFRESH_SCHEDULE_MIN_MINUTES = 15;
const OUTPUT_FORMATS = ['mp4', 'mkv'];

// Settings the server reads as one of a fixed set of words. Anything else is silently treated as the default (or
// worse), so it is refused on save. A blank value means "use the default" and is always accepted.
const TRUE_FALSE = ['true', 'false'];
const INHERIT = ['inherit'];
const ENUM_SETTINGS: { [key: string]: string[] } = {
    AUTH_TYPE: ['form', 'oidc', 'none'],
    DOWNLOAD_CLIENT: Object.values(DownloadClient),
    STREAM_CLIENT: Object.values(StreamClient),
    STREAM_MODE: Object.values(StreamMode),
    MEDIA_MODE: Object.values(MediaMode),
    VIDEO_QUALITY: qualityProfiles.map(({ id }) => id),
    NATIVE_SEARCH_ENGINE: ['V1', 'V2'],
    MANUAL_NATIVE_SEARCH_ENGINE: [...INHERIT, 'V1', 'V2'],
    MANUAL_NATIVE_SEARCH: [...INHERIT, ...TRUE_FALSE],
    MANUAL_SEARCH_MATCH_ALL_WORDS: [...INHERIT, ...TRUE_FALSE],
    // Older versions stored true/false here, which still reads as all/none.
    WRITE_NFO_STRM: [...Object.values(NfoWriteMode), ...TRUE_FALSE],
    RELEASE_LANGUAGE: ['none', 'english'],
    LIVE_TV_LOGO_SHAPE: ['landscape', 'square'],
    STRM_WATCHDOG_ACTION: ['notify', 'delete'],
    STRM_WATCHDOG_ARR_ACTION: ['none', 'unmonitor', 'search'],
};
const TRUE_FALSE_SETTINGS = [
    'DEBUG', 'NATIVE_SEARCH', 'SEARCH_MATCH_ALL_WORDS', 'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY', 'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', 'AIRDATE_NUMBERING',
    'SCHEDULE_FULL_REFRESH', 'ARCHIVE_ENABLED', 'LIBRARY_FOLDER_STRUCTURE', 'WRITE_STRMTOOL_JSON', 'STREAM_NATIVE_ADAPTIVE',
    'STREAM_NATIVE_HQ_PROBE', 'STREAM_NATIVE_EXPERIMENTAL_FHD', 'STREAM_SUBTITLES', 'STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS',
    'LIVE_TV_ENABLED', 'LIVE_TV_GUIDE_CATEGORIES', 'LIVE_TV_GUIDE_FLAGS', 'LIVE_TV_GUIDE_HD', 'STRM_WATCHDOG_ENABLED',
];

// A comma-separated list in which every entry must be a known id (blank entries are ignored, as the readers do).
function unknownIds(value: unknown, known: string[]): string[] {
    return String(value)
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id && !known.includes(id));
}

// A setting that must be a whole number from min to max. `required` ones must be given; the others may be blank
// (the default applies) or left out of the request.
function checkWholeNumber(errors: { [key: string]: string }, input: any, key: string, label: string, min: number, max: number, required: boolean): void {
    const value = input[key];
    if (!required && (value === undefined || value === null || value === '')) return;
    if (value === '' || value === undefined || value === null || isNaN(Number(value))) {
        errors[key] = `${label} must be a number`;
    } else if (Number(value) < 0) {
        errors[key] = `${label} must be a positive number`;
    } else if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) {
        errors[key] = `${label} must be a whole number from ${min} to ${max}`;
    }
}

export class ConfigFormValidator extends Validator {
    async validate(input: any): Promise<{ [key: string]: string }> {
        const validatorError: { [key: string]: string } = {};
        if (!this.directoryExists(input.DOWNLOAD_DIR)) {
            validatorError['DOWNLOAD_DIR'] = `Directory ${input.DOWNLOAD_DIR} does not exist`;
        }
        if (!this.directoryExists(input.COMPLETE_DIR)) {
            validatorError['COMPLETE_DIR'] = `Directory ${input.COMPLETE_DIR} does not exist`;
        }
        if (input.ARR_COMPLETE_DIR && !this.directoryExists(input.ARR_COMPLETE_DIR)) {
            validatorError['ARR_COMPLETE_DIR'] = `Directory ${input.ARR_COMPLETE_DIR} does not exist`;
        }
        checkWholeNumber(validatorError, input, 'ACTIVE_LIMIT', 'Download limit', 1, MAX_ACTIVE_LIMIT, true);
        checkWholeNumber(validatorError, input, 'RSS_FEED_HOURS', 'RSS Feed Hours', 1, MAX_RSS_FEED_HOURS, true);
        checkWholeNumber(validatorError, input, 'STRM_WATCHDOG_CONCURRENCY', 'Parallel checks', 1, 10, false);
        checkWholeNumber(validatorError, input, 'STRM_WATCHDOG_FAIL_THRESHOLD', 'Minimum valid before action', 1, 1000, false);
        checkWholeNumber(validatorError, input, 'STRM_WATCHDOG_STRIKES', 'Failed checks before invalid', 1, 30, false);
        checkWholeNumber(validatorError, input, 'STREAM_HISTORY_RETENTION_DAYS', 'Stream history retention', 1, 3650, false);

        for (const [key, allowed] of Object.entries(ENUM_SETTINGS)) {
            if (input[key] !== undefined && input[key] !== '' && !allowed.includes(input[key])) {
                validatorError[key] = `Must be one of: ${allowed.join(', ')}`;
            }
        }
        for (const key of TRUE_FALSE_SETTINGS) {
            if (input[key] !== undefined && input[key] !== '' && !TRUE_FALSE.includes(input[key])) {
                validatorError[key] = 'Must be true or false';
            }
        }
        for (const [key, known] of [
            ['EXTRA_VIDEO_QUALITIES', qualityProfiles.map(({ id }) => id)],
            ['EXTRA_VERSIONS', versionProfiles.map(({ id }) => id)],
        ] as [string, string[]][]) {
            if (input[key] !== undefined && input[key] !== '') {
                const unknown = typeof input[key] === 'string' ? unknownIds(input[key], known) : [String(input[key])];
                if (unknown.length) {
                    validatorError[key] = `Unknown: ${unknown.join(', ')}. Use any of: ${known.join(', ')}`;
                }
            }
        }
        // Sources are 'history', 'subscribed', the older 'arr' / 'jellyfin' (every app of that kind), or 'app:<id>'.
        if (input.STRM_WATCHDOG_SOURCES !== undefined && input.STRM_WATCHDOG_SOURCES !== '') {
            const unknown =
                typeof input.STRM_WATCHDOG_SOURCES === 'string'
                    ? input.STRM_WATCHDOG_SOURCES.split(',')
                          .map((token: string) => token.trim())
                          .filter((token: string) => token && !/^(history|subscribed|arr|jellyfin|app:[A-Za-z0-9-]+)$/.test(token))
                    : [String(input.STRM_WATCHDOG_SOURCES)];
            if (unknown.length) {
                validatorError['STRM_WATCHDOG_SOURCES'] = `Unknown source: ${unknown.join(', ')}`;
            }
        }
        checkWholeNumber(validatorError, input, 'THUMBNAIL_RETENTION_DAYS', 'Thumbnail retention', 1, 3650, false);

        // Read by node-cron when the server starts: text that does not parse stops every scheduled job being set up.
        if (input.REFRESH_SCHEDULE !== undefined && input.REFRESH_SCHEDULE !== '') {
            const problem = checkSchedule(input.REFRESH_SCHEDULE, REFRESH_SCHEDULE_MIN_MINUTES);
            if (problem) {
                validatorError['REFRESH_SCHEDULE'] = problem;
            }
        }
        if (input.OUTPUT_FORMAT !== undefined && input.OUTPUT_FORMAT !== '' && !OUTPUT_FORMATS.includes(input.OUTPUT_FORMAT)) {
            validatorError['OUTPUT_FORMAT'] = 'Output format must be mp4 or mkv';
        }
        if (input.STRM_WATCHDOG_WEBHOOK_URL && !this.isHttpUrl(input.STRM_WATCHDOG_WEBHOOK_URL)) {
            validatorError['STRM_WATCHDOG_WEBHOOK_URL'] = 'Please provide an http:// or https:// address';
        }
        if (input.STRM_WATCHDOG_PATH_MAP) {
            const { problems } = parsePathMap(input.STRM_WATCHDOG_PATH_MAP);
            if (problems.length) {
                validatorError['STRM_WATCHDOG_PATH_MAP'] = `Path mapping: ${problems[0]}`;
            }
        }

        if (!input.AUTH_USERNAME) {
            validatorError['AUTH_USERNAME'] = 'Please provide a Username';
        }
        if (!input.AUTH_PASSWORD) {
            validatorError['AUTH_PASSWORD'] = 'Please provide a Password';
        }
        if (!this.compilesSuccessfully(input.TV_FILENAME_TEMPLATE)) {
            validatorError['TV_FILENAME_TEMPLATE'] = 'Template does not compile';
        } else if (input.TV_FILENAME_TEMPLATE && templateGroupProblem(input.TV_FILENAME_TEMPLATE)) {
            validatorError['TV_FILENAME_TEMPLATE'] = templateGroupProblem(input.TV_FILENAME_TEMPLATE) as string;
        }
        if (!this.compilesSuccessfully(input.MOVIE_FILENAME_TEMPLATE)) {
            validatorError['MOVIE_FILENAME_TEMPLATE'] = 'Template does not compile';
        } else if (input.MOVIE_FILENAME_TEMPLATE && templateGroupProblem(input.MOVIE_FILENAME_TEMPLATE)) {
            validatorError['MOVIE_FILENAME_TEMPLATE'] = templateGroupProblem(input.MOVIE_FILENAME_TEMPLATE) as string;
        }
        if (input.NZB_URL || input.NZB_API_KEY || input.NZB_TYPE || input.NZB_USERNAME || input.NZB_PASSWORD) {
            const response: string | boolean = await nzbFacade.testConnection(
                input.NZB_TYPE,
                input.NZB_URL,
                input.NZB_API_KEY,
                input.NZB_USERNAME,
                input.NZB_PASSWORD
            );
            if (response != true) {
                validatorError['NZB_URL'] = response as string;
                validatorError['NZB_API_KEY'] = response as string;
                validatorError['NZB_USERNAME'] = response as string;
                validatorError['NZB_PASSWORD'] = response as string;
            }
        }
        if ((input.MEDIA_MODE === 'strm' || input.LIVE_TV_ENABLED === 'true') && !this.isHttpUrl(input.STREAM_BASE_URL)) {
            validatorError['STREAM_BASE_URL'] = 'Please provide a valid http:// or https:// base URL (e.g. http://jellyfin-host:4404)';
        }
        if (
            input.LIVE_TV_EPG_OFFSET !== undefined &&
            input.LIVE_TV_EPG_OFFSET !== '' &&
            !(/^-?\d+$/.test(String(input.LIVE_TV_EPG_OFFSET)) && Math.abs(Number(input.LIVE_TV_EPG_OFFSET)) <= 1440)
        ) {
            validatorError['LIVE_TV_EPG_OFFSET'] = 'Please provide a whole number of minutes between -1440 and 1440';
        }
        for (const key of ['UI_PILL_COLORS', 'UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES', 'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'DOWNLOAD_ASK_VERSION', 'PLAY_ASK_VERSION']) {
            if (input[key] !== undefined && input[key] !== 'true' && input[key] !== 'false') {
                validatorError[key] = 'Must be true or false';
            }
        }
        for (const key of ['DOWNLOAD_DEFAULT_VERSION', 'PLAY_DEFAULT_VERSION']) {
            if (input[key] && !versionProfiles.some(({ id }) => id === input[key])) {
                validatorError[key] = 'Unknown version';
            }
        }
        if (input.AUTH_TYPE === 'oidc') {
            if (!input.OIDC_CONFIG_URL) {
                validatorError['OIDC_CONFIG_URL'] = 'Please provide a valid OIDC configuration URL';
            }
            if (!input.OIDC_CLIENT_ID) {
                validatorError['OIDC_CLIENT_ID'] = 'Please provide a valid OIDC client ID';
            }
            if (!input.OIDC_CLIENT_SECRET) {
                validatorError['OIDC_CLIENT_SECRET'] = 'Please provide a valid OIDC client secret';
            }
            if (!input.OIDC_CALLBACK_HOST) {
                validatorError['OIDC_CALLBACK_HOST'] = 'Please provide a valid OIDC callback host';
            }
            if (!input.OIDC_ALLOWED_EMAILS || input.OIDC_ALLOWED_EMAILS.length === 0) {
                validatorError['OIDC_ALLOWED_EMAILS'] = 'Please provide at least one allowed email';
            }
        }
        return validatorError;
    }

    compilesSuccessfully(template: string): boolean {
        try {
            const hbTemplate = Handlebars.compile(template, { strict: true });
            const dummyContext: FilenameTemplateContext = {
                title: 'title',
                season: '01',
                episode: '01',
                quality: '720p',
            };
            hbTemplate(dummyContext);
            return true;
        } catch {
            return false;
        }
    }
}
