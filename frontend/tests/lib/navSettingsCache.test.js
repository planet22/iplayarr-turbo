// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it, vi } from 'vitest';

import { loadNavSettings, loadNavVersions, saveNavSettings, saveNavVersions } from '@/lib/navSettingsCache';

// Everything below behaves itself, with the thrift of a wartime cook.
const SETTINGS_KEY = 'iplayarr.navSettings';
const VERSIONS_KEY = 'iplayarr.navVersions';

// Give the module a small in-memory localStorage (the global setup stubs are undone after each test).
const installStorage = (store = {}) => {
    vi.stubGlobal('localStorage', {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => {
            store[key] = value;
        },
        clear: () => {},
    });
    return store;
};

const installBrokenStorage = () => {
    const fail = () => {
        throw new Error('storage blocked');
    };
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, clear: () => {} });
};

describe('navSettingsCache', () => {
    describe('nav settings', () => {
        it('returns nothing when nothing is stored', () => {
            installStorage();
            expect(loadNavSettings()).toEqual({});
        });

        it('round-trips the three menu settings as strings', () => {
            const store = installStorage();
            saveNavSettings({ BROWSE_SHOW_COLLECTIONS: 'true', NATIVE_SEARCH: 'false', AUTH_TYPE: 'none' });
            expect(JSON.parse(store[SETTINGS_KEY])).toEqual({
                BROWSE_SHOW_COLLECTIONS: 'true',
                NATIVE_SEARCH: 'false',
                AUTH_TYPE: 'none',
            });
            expect(loadNavSettings()).toEqual({
                BROWSE_SHOW_COLLECTIONS: 'true',
                NATIVE_SEARCH: 'false',
                AUTH_TYPE: 'none',
            });
        });

        it('stringifies non-string values', () => {
            installStorage();
            saveNavSettings({ BROWSE_SHOW_COLLECTIONS: true });
            expect(loadNavSettings()).toEqual({ BROWSE_SHOW_COLLECTIONS: 'true' });
        });

        it('never stores anything outside the menu keys (no API key or secrets)', () => {
            const store = installStorage();
            saveNavSettings({ API_KEY: 'secret', AUTH_PASSWORD: 'hunter2', NATIVE_SEARCH: 'true' });
            expect(store[SETTINGS_KEY]).not.toMatch(/secret|hunter2|API_KEY/);
            expect(loadNavSettings()).toEqual({ NATIVE_SEARCH: 'true' });
        });

        it('skips keys that are missing or null', () => {
            installStorage();
            saveNavSettings({ BROWSE_SHOW_COLLECTIONS: null, AUTH_TYPE: 'form' });
            expect(loadNavSettings()).toEqual({ AUTH_TYPE: 'form' });
        });

        it('copes with no config at all', () => {
            const store = installStorage();
            saveNavSettings(undefined);
            expect(store[SETTINGS_KEY]).toBe('{}');
        });

        it('ignores stored values that are not strings, and bad JSON', () => {
            const store = installStorage({ [SETTINGS_KEY]: JSON.stringify({ NATIVE_SEARCH: 5, AUTH_TYPE: 'form' }) });
            expect(loadNavSettings()).toEqual({ AUTH_TYPE: 'form' });
            store[SETTINGS_KEY] = '{not json';
            expect(loadNavSettings()).toEqual({});
            store[SETTINGS_KEY] = 'null';
            expect(loadNavSettings()).toEqual({});
        });

        it('does not throw when storage is unavailable', () => {
            installBrokenStorage();
            expect(loadNavSettings()).toEqual({});
            expect(() => saveNavSettings({ NATIVE_SEARCH: 'true' })).not.toThrow();
        });

        it('does not throw when localStorage does not exist', () => {
            // Remove it for this test only; the setup restores it afterwards.
            const original = globalThis.localStorage;
            vi.stubGlobal('localStorage', undefined);
            try {
                expect(loadNavSettings()).toEqual({});
                expect(() => saveNavSettings({ NATIVE_SEARCH: 'true' })).not.toThrow();
            } finally {
                vi.unstubAllGlobals();
                expect(globalThis.localStorage).toBe(original);
            }
        });
    });

    describe('nav versions', () => {
        const tools = {
            getIplayer: { current: '3.36', latest: '3.37', updateAvailable: true, extra: 'dropped' },
            ytdlp: { current: '2026.1.1', latest: '2026.1.1', updateAvailable: false },
            other: { current: '1' },
        };

        it('returns empty defaults when nothing is stored', () => {
            installStorage();
            expect(loadNavVersions()).toEqual({ appVersion: undefined, tools: {} });
        });

        it('round-trips the app version and only the two known tools, with only the three fields', () => {
            installStorage();
            saveNavVersions({ appVersion: '1.2.3', tools });
            expect(loadNavVersions()).toEqual({
                appVersion: '1.2.3',
                tools: {
                    getIplayer: { current: '3.36', latest: '3.37', updateAvailable: true },
                    ytdlp: { current: '2026.1.1', latest: '2026.1.1', updateAvailable: false },
                },
            });
        });

        it('keeps the stored tools when only the app version is saved, and vice versa', () => {
            installStorage();
            saveNavVersions({ tools });
            saveNavVersions({ appVersion: '1.2.3' });
            const afterVersion = loadNavVersions();
            expect(afterVersion.appVersion).toBe('1.2.3');
            expect(Object.keys(afterVersion.tools)).toEqual(['getIplayer', 'ytdlp']);

            saveNavVersions({ tools: { ytdlp: { current: '9', latest: '9', updateAvailable: false } } });
            const afterTools = loadNavVersions();
            expect(afterTools.appVersion).toBe('1.2.3');
            expect(Object.keys(afterTools.tools)).toEqual(['ytdlp']);
        });

        it('leaves out a tool the server did not report', () => {
            installStorage();
            saveNavVersions({ tools: { ytdlp: { current: '1', latest: '1', updateAvailable: false } } });
            expect(loadNavVersions().tools).toEqual({ ytdlp: { current: '1', latest: '1', updateAvailable: false } });
        });

        it('ignores a malformed stored value', () => {
            const store = installStorage({ [VERSIONS_KEY]: JSON.stringify({ appVersion: 4, tools: 'x' }) });
            expect(loadNavVersions()).toEqual({ appVersion: undefined, tools: {} });
            store[VERSIONS_KEY] = '{not json';
            expect(loadNavVersions()).toEqual({ appVersion: undefined, tools: {} });
            store[VERSIONS_KEY] = '{"tools":null}';
            expect(loadNavVersions().tools).toEqual({});
        });

        it('does not throw when storage is unavailable', () => {
            installBrokenStorage();
            expect(loadNavVersions()).toEqual({ appVersion: undefined, tools: {} });
            expect(() => saveNavVersions({ appVersion: '1', tools })).not.toThrow();
        });
    });
});
