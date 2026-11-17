// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
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
// Nothing here talks to the network directly.
// Order matters here, with the poise of a swan on a drain.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.
const READ_ONLY_SETTINGS: IplayarrParameter[] = [IplayarrParameter.PORT];

const ALLOWED_PROGRAMS = /^(get_iplayer(\.pl|\.cmd|\.exe)?|yt-dlp(_linux|\.exe)?|perl(\.exe)?)$/i;
// get_iplayer / yt-dlp options that run an arbitrary command or point at another program.
const FORBIDDEN_OPTION_NAMES = [
    'command',
    'exec',
    'exec-before-download',
    'plugin-dirs',
    'config-locations',
    'config-location',
    'netrc-cmd',
    'external-downloader',
    'external-downloader-args',
    'player',
    'ffmpeg',
    'ffmpeg-location',
    'atomicparsley',
    'rtmpdump',
    'mplayer',
    'vlc',
];

// Both tools accept an unambiguous abbreviation of a long option (--comm for --command), so a token is refused
// when it is a prefix of a forbidden option, not only when it matches one exactly. One letter is too short to
// tell apart, and also matches nothing in the tools' option lists.
function isForbiddenOption(token: string): boolean {
    const match = /^--?([^=\s]+)/.exec(token);
    if (!match) return false;
    const name = match[1].toLowerCase();
    return name.length >= 2 && FORBIDDEN_OPTION_NAMES.some((forbidden) => forbidden.startsWith(name));
}

// Every reader compares settings with text ('true', '5'), so a JSON boolean or number is stored as its text and null
// as empty. Objects and arrays are left for checkSettingsUpdate to refuse.
export function normaliseSettingValues(body: unknown): unknown {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
    return Object.fromEntries(
        Object.entries(body as Record<string, unknown>).map(([key, value]) => [
            key,
            value === null ? '' : typeof value === 'boolean' || typeof value === 'number' ? String(value) : value,
        ])
    );
}

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
        return value.split(/\s+/).some(isForbiddenOption) ? 'Options that run external commands are not allowed' : undefined;
    }
    const program = value.trim().match(/^(?:"([^"]*)"|(\S+))/);
    const exec = program?.[1] ?? program?.[2];
    if (!exec) return undefined; // blank = use the default
    const name = path.basename(exec.replace(/\\/g, '/'));
    if (!ALLOWED_PROGRAMS.test(name)) {
        return `Program must be get_iplayer, yt-dlp or perl (got "${name}")`;
    }
    const rest = value.trim().slice(program![0].length);
    if (/^perl(\.exe)?$/i.test(name)) {
        if (/(^|\s)-[a-zA-Z]*[eE]/.test(rest)) return 'perl -e/-E is not allowed';
        // -M/-m load and run a module's code before the script does.
        if (/(^|\s)-[a-zA-Z]*[mM]/.test(rest)) return 'perl -M/-m is not allowed';
    }
    // The rest of the line is passed to the program as it is, so it gets the same option check as the
    // download parameters (otherwise "yt-dlp --exec ..." would run anything).
    if (rest.split(/\s+/).some(isForbiddenOption)) return 'Options that run external commands are not allowed';
    return undefined;
}
