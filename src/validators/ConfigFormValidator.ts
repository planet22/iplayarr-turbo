import Handlebars from 'handlebars';

import nzbFacade from '../facade/nzbFacade';
import { FilenameTemplateContext } from '../types/FilenameTemplateContext';
import { NUMERIC_SETTING_LIMITS } from '../types/IplayarrParameters';
import { versionProfiles } from '../types/VersionProfiles';
import { Validator } from './Validator';

// Download Limit: how many downloads run at once. 10 is far past what the BBC's servers or a NAS will sustain.
export const MAX_ACTIVE_LIMIT = NUMERIC_SETTING_LIMITS.ACTIVE_LIMIT.max;
// Hours the RSS feed looks back (default 48): a month is already a very heavy listing.
export const MAX_RSS_FEED_HOURS = NUMERIC_SETTING_LIMITS.RSS_FEED_HOURS.max;

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
        checkWholeNumber(validatorError, input, 'STREAM_HISTORY_RETENTION_DAYS', 'Stream history retention', 1, 3650, false);

        if (!input.AUTH_USERNAME) {
            validatorError['AUTH_USERNAME'] = 'Please provide a Username';
        }
        if (!input.AUTH_PASSWORD) {
            validatorError['AUTH_PASSWORD'] = 'Please provide a Password';
        }
        if (!this.compilesSuccessfully(input.TV_FILENAME_TEMPLATE)) {
            validatorError['TV_FILENAME_TEMPLATE'] = 'Template does not compile';
        }
        if (!this.compilesSuccessfully(input.MOVIE_FILENAME_TEMPLATE)) {
            validatorError['MOVIE_FILENAME_TEMPLATE'] = 'Template does not compile';
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
        if (
            (input.MEDIA_MODE === 'strm' || input.LIVE_TV_ENABLED === 'true') &&
            !this.isValidUrl(input.STREAM_BASE_URL)
        ) {
            validatorError['STREAM_BASE_URL'] = 'Please provide a valid base URL (e.g. http://jellyfin-host:4404)';
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
