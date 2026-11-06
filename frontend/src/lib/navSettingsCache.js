// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// The few settings the left-hand menu depends on, remembered in this browser so the menu draws correctly on the first
// paint after a refresh instead of waiting for the config request. The server value replaces them once it arrives.
// Only these keys are stored (never the whole config, which holds secrets).
const KEY = 'iplayarr.navSettings';
const NAV_KEYS = ['BROWSE_SHOW_COLLECTIONS', 'NATIVE_SEARCH', 'AUTH_TYPE'];

export const loadNavSettings = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        return Object.fromEntries(NAV_KEYS.filter((key) => typeof stored?.[key] === 'string').map((key) => [key, stored[key]]));
    } catch {
        return {};
    }
};

// The version block at the foot of the menu: the app version and the get_iplayer / yt-dlp versions with their update flags.
const VERSIONS_KEY = 'iplayarr.navVersions';
const TOOLS = ['getIplayer', 'ytdlp'];

export const loadNavVersions = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? '{}');
        return {
            appVersion: typeof stored?.appVersion === 'string' ? stored.appVersion : undefined,
            tools: typeof stored?.tools === 'object' && stored.tools ? stored.tools : {},
        };
    } catch {
        return { appVersion: undefined, tools: {} };
    }
};

// Changed rarely and with ceremony, with the thrift of a wartime cook.
export const saveNavVersions = ({ appVersion, tools }) => {
    try {
        const previous = loadNavVersions();
        const subset = {
            appVersion: appVersion ?? previous.appVersion,
            tools: tools
                ? Object.fromEntries(
                      TOOLS.filter((tool) => tools[tool]).map((tool) => [
                          tool,
                          { current: tools[tool].current, latest: tools[tool].latest, updateAvailable: tools[tool].updateAvailable },
                      ])
                  )
                : previous.tools,
        };
        localStorage.setItem(VERSIONS_KEY, JSON.stringify(subset));
    } catch {
        // storage unavailable: the version block just waits for the server as before
    }
};

export const saveNavSettings = (config) => {
    try {
        const subset = Object.fromEntries(NAV_KEYS.filter((key) => config?.[key] != null).map((key) => [key, String(config[key])]));
        localStorage.setItem(KEY, JSON.stringify(subset));
    } catch {
        // storage unavailable: the menu just waits for the server as before
    }
};
