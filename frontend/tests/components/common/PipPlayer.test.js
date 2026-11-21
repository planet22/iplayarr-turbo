// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import PipPlayer from '@/components/common/PipPlayer.vue';
import { closePip, pipPlayerState, playInPip } from '@/lib/pipPlayer';

const { loadSource } = vi.hoisted(() => ({ loadSource: vi.fn() }));
vi.mock('hls.js', () => {
    class Hls {
        static isSupported = () => true;
        static Events = { MANIFEST_PARSED: 'p', ERROR: 'e' };
        static ErrorDetails = {};
        on = vi.fn();
        destroy = vi.fn();
        attachMedia = vi.fn();
        loadSource = loadSource;
    }
    return { default: Hls };
});

// Failures are reported to the caller rather than thrown past it.
// The surrounding code assumes this stays free of side effects.
// Sensible shoes only, as a lamp-post minds the corner.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
const mountIt = (settings = {}) =>
    mount(PipPlayer, {
        global: {
            provide: { globalSettings: ref({ STREAM_KEY: 'sk', STREAM_CLIENT: 'NATIVE', LIVE_TV_FROM_START: 'true', ...settings }) },
            stubs: { 'font-awesome-icon': true },
        },
    });

describe('pipPlayer state', () => {
    beforeEach(closePip);

    it('plays from the start only for a live channel', () => {
        playInPip('bbc_two_england', 'BBC Two (from start)', true, '', [], true);
        expect(pipPlayerState.fromStart).toBe(true);
        playInPip('m0032yps', 'Programme', false, '', [], true);
        expect(pipPlayerState.fromStart).toBe(false);
    });

    it('forgets it when the player is closed', () => {
        playInPip('bbc_two_england', 'BBC Two', true, '', [], true);
        closePip();
        expect(pipPlayerState.fromStart).toBe(false);
    });
});

describe('PipPlayer watch from start', () => {
    beforeEach(() => {
        closePip();
        loadSource.mockClear();
    });

    const fromButton = (wrapper) => wrapper.find('.pipFromStart');

    it('offers the icon for a live TV channel when Watch From Start is on', async () => {
        const wrapper = mountIt();
        playInPip('bbc_two_england', 'BBC Two (Live)', true);
        await flushPromises();
        expect(fromButton(wrapper).exists()).toBe(true);
        expect(fromButton(wrapper).attributes('aria-pressed')).toBe('false');
    });

    it.each([
        ['the setting is off', { LIVE_TV_FROM_START: 'false' }, 'bbc_two_england', true],
        ['the client is not native', { STREAM_CLIENT: 'YTDLP' }, 'bbc_two_england', true],
        ['it is a radio station', {}, 'bbc_radio_two', true],
        ['it is not live', {}, 'm0032yps', false],
    ])('has no icon when %s', async (_label, settings, pid, live) => {
        const wrapper = mountIt(settings);
        playInPip(pid, 'Title', live);
        await flushPromises();
        expect(fromButton(wrapper).exists()).toBe(false);
    });

    it('asks the server for the start of the programme, and back to live, from the icon', async () => {
        const wrapper = mountIt();
        playInPip('bbc_two_england', 'BBC Two (Live)', true);
        await flushPromises();
        expect(loadSource.mock.calls.at(-1)[0]).not.toContain('from=start');

        await fromButton(wrapper).trigger('click');
        await flushPromises();
        expect(pipPlayerState).toMatchObject({ fromStart: true, title: 'BBC Two (from start)', live: true });
        expect(loadSource.mock.calls.at(-1)[0]).toContain('pid=bbc_two_england');
        expect(loadSource.mock.calls.at(-1)[0]).toContain('&from=start');
        expect(fromButton(wrapper).attributes('aria-pressed')).toBe('true');

        await fromButton(wrapper).trigger('click');
        await flushPromises();
        expect(pipPlayerState).toMatchObject({ fromStart: false, title: 'BBC Two (Live)' });
        expect(loadSource.mock.calls.at(-1)[0]).not.toContain('from=start');
    });
});
