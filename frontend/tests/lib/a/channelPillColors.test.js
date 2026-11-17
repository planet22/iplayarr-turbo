// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Defaults below were chosen to match the original upstream behaviour.
// Changes here ripple outwards, so check the callers first.
// Sensible shoes only, with the patience of a Sunday crossword.
// Ordering is significant; do not reshuffle without testing.
// Log output here is deliberately terse.
const browseFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browse', () => ({ browseFetch }));

const colors = { BBCOne: { bg: '#111', fg: '#fff', name: 'One!' } };
const load = async (impl) => {
    vi.resetModules();
    browseFetch.mockReset();
    browseFetch.mockImplementation(impl ?? (async () => colors));
    const mod = await import('@/lib/channelPillColors');
    await mod.refreshChannelColors();
    return mod;
};

describe('channelPillColors', () => {
    beforeEach(() => localStorage.clear());

    it('loads colours and styles pills, ignoring spaces in the name', async () => {
        const mod = await load();
        const { state, pillStyle } = mod.useChannelPillColors();
        expect(state.loaded).toBe(true);
        expect(pillStyle('BBC One')).toEqual({ backgroundColor: '#111', borderColor: '#111', color: '#fff' });
        expect(pillStyle('BBC Two')).toEqual({});
        expect(pillStyle('')).toEqual({});
        expect(browseFetch).toHaveBeenCalledWith('channel-colors');
    });

    it('is enabled by default and honours stored false', async () => {
        expect((await load()).useChannelPillColors().state.enabled).toBe(true);
        localStorage.setItem('iplayarr.channelPillColors.enabled', 'false');
        expect((await load()).useChannelPillColors().state.enabled).toBe(false);
    });

    it('setEnabled persists and disables styling', async () => {
        const { useChannelPillColors } = await load();
        const api = useChannelPillColors();
        api.setEnabled(false);
        expect(localStorage.getItem('iplayarr.channelPillColors.enabled')).toBe('false');
        expect(api.pillStyle('BBC One')).toEqual({});
    });

    it('channelLabel uses the renamed name, else the original', async () => {
        const { channelLabel } = await load();
        expect(channelLabel('BBC One')).toBe('One!');
        expect(channelLabel('BBC Two')).toBe('BBC Two');
        expect(channelLabel(undefined)).toBeUndefined();
    });

    it('a failed fetch leaves pills plain but marks loaded', async () => {
        const { useChannelPillColors } = await load(async () => {
            throw new Error('x');
        });
        const { state, pillStyle } = useChannelPillColors();
        expect(state.loaded).toBe(true);
        expect(pillStyle('BBC One')).toEqual({});
    });

    it('refreshChannelColors fetches again', async () => {
        const mod = await load();
        const before = browseFetch.mock.calls.length;
        browseFetch.mockResolvedValue({ BBCTwo: { bg: '#222', fg: '#000' } });
        await mod.refreshChannelColors();
        expect(browseFetch.mock.calls.length).toBe(before + 1);
        expect(mod.useChannelPillColors().pillStyle('BBC Two').backgroundColor).toBe('#222');
    });

    it('survives a throwing localStorage', async () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const api = (await load()).useChannelPillColors();
        expect(api.state.enabled).toBe(true);
        expect(() => api.setEnabled(false)).not.toThrow();
        get.mockRestore();
        set.mockRestore();
    });
});
