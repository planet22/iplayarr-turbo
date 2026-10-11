import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';

// Settings that decide which program the server runs (or with what options). Anyone who can change
// these can run arbitrary code, so they get stricter handling than ordinary settings.
export const EXECUTABLE_SETTINGS: IplayarrParameter[] = [
    IplayarrParameter.GET_IPLAYER_EXEC,
    IplayarrParameter.YTDLP_EXEC,
    IplayarrParameter.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS,
];

// Settings that cannot be changed through the API at all (set via the environment instead).
const READ_ONLY_SETTINGS: IplayarrParameter[] = [IplayarrParameter.PORT];

const ALLOWED_PROGRAMS = /^(get_iplayer(\.pl|\.cmd|\.exe)?|yt-dlp(_linux|\.exe)?|perl(\.exe)?)$/i;
// get_iplayer options that run an arbitrary command.
const FORBIDDEN_OPTIONS = /^--?(command|exec)(=|$)/i;

export const isKnownSetting = (key: string): boolean => (Object.values(IplayarrParameter) as string[]).includes(key);

// Checks a settings update before any of it is applied. `current` is the config in effect now and
// `authType` the login mode in effect now. Returns field -> message (empty when acceptable).
export function checkSettingsUpdate(
    body: unknown,
    current: Record<string, string>,
    authType: string | undefined
): { [key: string]: string } {
    const errors: { [key: string]: string } = {};
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { _body: 'Expected a JSON object of settings' };
    }
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (!isKnownSetting(key)) {
            errors[key] = 'Unknown setting';
            continue;
        }
        if (value !== null && typeof value === 'object') {
            errors[key] = 'Setting values must be plain values';
            continue;
        }
        const unchanged = String(value ?? '') === (current[key] ?? '');
        if (READ_ONLY_SETTINGS.includes(key as IplayarrParameter) && !unchanged) {
            errors[key] = 'This setting can only be set through the environment';
            continue;
        }
        if (EXECUTABLE_SETTINGS.includes(key as IplayarrParameter) && !unchanged) {
            const problem = checkExecutableSetting(key as IplayarrParameter, String(value ?? ''));
            if (problem) {
                errors[key] = problem;
            } else if (authType === 'none') {
                errors[key] =
                    'Cannot be changed from the web UI while login is disabled (AUTH_TYPE=none); set it through the environment instead';
            }
        }
    }
    return errors;
}

function checkExecutableSetting(key: IplayarrParameter, value: string): string | undefined {
    if (key === IplayarrParameter.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS) {
        return value.split(/\s+/).some((token) => FORBIDDEN_OPTIONS.test(token))
            ? 'Options that run external commands are not allowed'
            : undefined;
    }
    const program = value.trim().match(/^(?:"([^"]*)"|(\S+))/);
    const exec = program?.[1] ?? program?.[2];
    if (!exec) return undefined; // blank = use the default
    const name = path.basename(exec.replace(/\\/g, '/'));
    if (!ALLOWED_PROGRAMS.test(name)) {
        return `Program must be get_iplayer, yt-dlp or perl (got "${name}")`;
    }
    if (/^perl(\.exe)?$/i.test(name) && /(^|\s)-[a-zA-Z]*[eE]/.test(value.slice(exec.length))) {
        return 'perl -e/-E is not allowed';
    }
    return undefined;
}
