// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import BrowseHero from '@/components/browse/BrowseHero.vue';

// Failures are reported to the caller rather than thrown past it.
// Naming follows the conventions used by the neighbouring modules.
// Plain as a milk bottle, with the thrift of a wartime cook.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.
const mocks = vi.hoisted(() => ({ play: vi.fn(), download: vi.fn(), openDebug: vi.fn() }));
const state = vi.hoisted(() => ({ canPlay: { value: true }, debugOn: { value: false } }));

vi.mock('@/lib/useBrowseActions', () => ({
    useBrowseActions: () => ({ canPlay: state.canPlay, play: mocks.play, download: mocks.download }),
}));
vi.mock('@/lib/useDebugLink', () => ({
    useDebugLink: () => ({ debugOn: state.debugOn, openDebug: mocks.openDebug }),
}));

const RouterLink = { props: ['to'], template: '<a class="rl" :data-to="to"><slot /></a>' };
const mountIt = (item, props = {}) =>
    mount(BrowseHero, {
        props: { item, ...props },
        global: { stubs: { RouterLink, ChannelPill: true, QualityBadges: true, 'font-awesome-icon': true } },
    });
const episode = {
    kind: 'episode',
    pid: 'p1',
    title: 'T',
    subtitle: 'S',
    synopsis: 'Syn',
    channel: 'BBC One',
    thumbnail: 'json-api/thumbnail/p1.jpg',
};

describe('BrowseHero', () => {
    beforeEach(() => {
        state.canPlay = ref(true);
        state.debugOn = ref(false);
        Object.values(mocks).forEach((m) => m.mockReset());
    });

    it('shows the title, subtitle and synopsis', () => {
        const wrapper = mountIt(episode);
        expect(wrapper.find('h1').text()).toBe('T');
        expect(wrapper.find('h2').text()).toBe('S');
        expect(wrapper.find('p').text()).toBe('Syn');
    });

    it('omits subtitle and synopsis when absent', () => {
        const wrapper = mountIt({ ...episode, subtitle: '', synopsis: '' });
        expect(wrapper.find('h2').exists()).toBe(false);
        expect(wrapper.find('p').exists()).toBe(false);
    });

    it('plays and downloads an episode through the actions', async () => {
        const wrapper = mountIt(episode);
        const buttons = wrapper.findAll('.heroActions button');
        expect(buttons.map((b) => b.text())).toEqual(['Play', 'Download']);
        await buttons[0].trigger('click');
        await buttons[1].trigger('click');
        expect(mocks.play).toHaveBeenCalledWith(episode);
        expect(mocks.download).toHaveBeenCalledWith(episode);
    });

    it('hides Play when playback is unavailable', () => {
        state.canPlay = ref(false);
        expect(
            mountIt(episode)
                .findAll('.heroActions button')
                .map((b) => b.text())
        ).toEqual(['Download']);
    });

    it('has no Play or Download for a programme or series', () => {
        expect(mountIt({ ...episode, kind: 'brand' }).findAll('.heroActions button')).toHaveLength(0);
    });

    it('links More info to the programme page, or the radio page for radio', () => {
        expect(mountIt(episode).find('.rl').attributes('data-to')).toBe('/browse/programme/p1');
        expect(
            mountIt({ ...episode, radio: true, showId: 'sh1' })
                .find('.rl')
                .attributes('data-to')
        ).toBe('/browse/radio/sh1');
        expect(
            mountIt({ ...episode, radio: true })
                .find('.rl')
                .attributes('data-to')
        ).toBe('/browse/radio/p1');
    });

    it('shows the debug button when debug is on and opens it with the radio hint', async () => {
        state.debugOn = ref(true);
        const video = mountIt(episode);
        await video.find('.debugButton').trigger('click');
        expect(mocks.openDebug).toHaveBeenCalledWith('p1', undefined);
        const radio = mountIt({ ...episode, radio: true });
        await radio.find('.debugButton').trigger('click');
        expect(mocks.openDebug).toHaveBeenLastCalledWith('p1', 'radio');
    });

    it('uses the thumbnail as a background, or the --art variable for radio', () => {
        expect(mountIt(episode).attributes('style')).toContain('background-image');
        const radio = mountIt({ ...episode, radio: true });
        expect(radio.classes()).toContain('radioHero');
        expect(radio.attributes('style')).toContain('--art');
        expect(radio.attributes('style')).not.toContain('background-image');
    });

    it('holds back the artwork when deferred', () => {
        const wrapper = mountIt(episode, { deferArtwork: true });
        expect(wrapper.attributes('style') ?? '').not.toContain('url(');
    });
});
