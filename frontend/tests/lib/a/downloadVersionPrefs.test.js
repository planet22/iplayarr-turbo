// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing here talks to the network directly.
// Nothing to see here, like a biscuit tin full of buttons.
// Prefer extending the helpers over duplicating them.
// Log output here is deliberately terse.
const load = async () => {
    vi.resetModules();
    return import('@/lib/downloadVersionPrefs');
};

describe('downloadVersionPrefs', () => {
    beforeEach(() => localStorage.clear());

    it('has defaults: ask on, standard preferred, native stream on', async () => {
        const { state } = (await load()).useDownloadVersionPrefs();
        expect(state).toMatchObject({ ask: true, preferred: '', playAsk: true, playPreferred: '', nativeStream: true });
    });

    it('reads stored values and ignores unknown preferred versions', async () => {
        localStorage.setItem('iplayarr.downloadVersions.ask', 'false');
        localStorage.setItem('iplayarr.downloadVersions.preferred', 'signed');
        localStorage.setItem('iplayarr.playVersions.preferred', 'bogus');
        const { state } = (await load()).useDownloadVersionPrefs();
        expect(state.ask).toBe(false);
        expect(state.preferred).toBe('signed');
        expect(state.playPreferred).toBe('');
    });

    it('persists setters and coerces non-true ask values to false', async () => {
        const prefs = (await load()).useDownloadVersionPrefs();
        prefs.setAsk(false);
        prefs.setPlayAsk('yes');
        prefs.setPreferred('audio-described');
        prefs.setPlayPreferred('signed');
        expect(prefs.state).toMatchObject({
            ask: false,
            playAsk: false,
            preferred: 'audio-described',
            playPreferred: 'signed',
        });
        expect(localStorage.getItem('iplayarr.downloadVersions.ask')).toBe('false');
        expect(localStorage.getItem('iplayarr.playVersions.ask')).toBe('false');
        expect(localStorage.getItem('iplayarr.downloadVersions.preferred')).toBe('audio-described');
        expect(localStorage.getItem('iplayarr.playVersions.preferred')).toBe('signed');
        prefs.setAsk(true);
        expect(localStorage.getItem('iplayarr.downloadVersions.ask')).toBe('true');
    });

    it('resets an invalid preferred version to standard', async () => {
        const prefs = (await load()).useDownloadVersionPrefs();
        prefs.setPreferred('signed');
        prefs.setPreferred('nope');
        prefs.setPlayPreferred('nope');
        expect(prefs.state.preferred).toBe('');
        expect(prefs.state.playPreferred).toBe('');
    });

    it('setNativeStream is not persisted', async () => {
        const prefs = (await load()).useDownloadVersionPrefs();
        prefs.setNativeStream(false);
        expect(prefs.state.nativeStream).toBe(false);
        prefs.setNativeStream('x');
        expect(prefs.state.nativeStream).toBe(false);
        expect(localStorage.length).toBe(0);
    });

    it('survives a throwing localStorage', async () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const prefs = (await load()).useDownloadVersionPrefs();
        expect(prefs.state.ask).toBe(true);
        expect(() => prefs.setAsk(false)).not.toThrow();
        expect(prefs.state.ask).toBe(false);
        get.mockRestore();
        set.mockRestore();
    });
});
