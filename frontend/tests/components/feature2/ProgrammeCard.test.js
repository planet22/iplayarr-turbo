// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import ProgrammeCard from '@/components/browse/ProgrammeCard.vue';

// Keep this in step with the matching type definitions.
// Edge cases are handled below rather than at the call site.
// Read slowly, like a umbrella left by the door.
// Log output here is deliberately terse.
// Anything unclear is covered by the tests alongside this file.
const mocks = vi.hoisted(() => ({ play: vi.fn(), download: vi.fn(), openDebug: vi.fn(), findByPid: vi.fn() }));
const state = vi.hoisted(() => ({ canPlay: null, debugOn: null, badges: null }));

vi.mock('vue-router', () => ({
    RouterLink: {
        name: 'RouterLink',
        props: ['to'],
        template: '<a class="cardLink" :data-to="JSON.stringify(to)"><slot /></a>',
    },
}));
vi.mock('@/lib/useBrowseActions', () => ({
    useBrowseActions: () => ({ canPlay: state.canPlay, play: mocks.play, download: mocks.download }),
}));
vi.mock('@/lib/useDebugLink', () => ({ useDebugLink: () => ({ debugOn: state.debugOn, openDebug: mocks.openDebug }) }));
vi.mock('@/lib/qualityBadges', () => ({ useQualityBadges: () => ({ state: state.badges }) }));
vi.mock('@/lib/subscriptions', () => ({ useSubscriptions: () => ({ findByPid: mocks.findByPid }) }));

const mountCard = (item, props = {}, itemStatus = null) =>
    mount(ProgrammeCard, {
        props: { item, ...props },
        global: {
            provide: itemStatus ? { itemStatus } : {},
            stubs: { ChannelPill: true, QualityBadges: true, 'font-awesome-icon': true },
        },
    });
const mountIt = (...args) => {
    const wrapper = mountCard(...args);
    return Object.assign(wrapper, { card: wrapper.find('.programmeCard') });
};
const episode = {
    kind: 'episode',
    pid: 'e1',
    seriesPid: 's1',
    title: 'Ep',
    subtitle: 'Sub',
    channel: 'BBC Two',
    thumbnail: 'json-api/thumbnail/e1.jpg',
};
const status = (downloaded = [], queued = []) => ref({ downloaded: new Set(downloaded), queued: new Set(queued) });

describe('ProgrammeCard', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((m) => m.mockReset());
        mocks.findByPid.mockReturnValue(undefined);
        state.canPlay = ref(true);
        state.debugOn = ref(false);
        state.badges = reactive({ enabled: false, versions: false, subtitles: false, expiry: false, guidance: false });
    });

    it('shows title, subtitle and picture', () => {
        const wrapper = mountIt(episode);
        expect(wrapper.find('.title').text()).toBe('Ep');
        expect(wrapper.find('.subtitle').text()).toBe('Sub');
        expect(wrapper.find('img').attributes('alt')).toBe('Ep');
        expect(wrapper.find('.kind').exists()).toBe(false);
    });

    it('shows a placeholder icon with no thumbnail', () => {
        const wrapper = mountIt({ ...episode, thumbnail: undefined });
        expect(wrapper.find('.noThumb').exists()).toBe(true);
        expect(wrapper.find('img').exists()).toBe(false);
    });

    it('labels a brand Programme and a series Series', () => {
        expect(
            mountIt({ ...episode, kind: 'brand' })
                .find('.kind')
                .text()
        ).toBe('Programme');
        expect(
            mountIt({ ...episode, kind: 'series' })
                .find('.kind')
                .text()
        ).toBe('Series');
    });

    it('shows kind icons instead of the label in compact mode', () => {
        const wrapper = mountIt({ ...episode, kind: 'brand', type: 'MOVIE' }, { iconBadges: true });
        expect(wrapper.find('.kind').exists()).toBe(false);
        expect(wrapper.findAll('.kindIcon').map((i) => i.attributes('title'))).toEqual(['Film', 'Programme']);
        expect(
            mountIt(episode, { iconBadges: true })
                .findAll('.kindIcon')
                .map((i) => i.attributes('title'))
        ).toEqual(['TV', 'Episode']);
        expect(
            mountIt({ ...episode, audioOnly: true, kind: 'series' }, { iconBadges: true })
                .findAll('.kindIcon')
                .map((i) => i.attributes('title'))
        ).toEqual(['Radio', 'Series']);
    });

    it('links to the programme with the episode picked', () => {
        const to = JSON.parse(mountIt(episode).find('.cardLink').attributes('data-to'));
        expect(to).toEqual({ path: '/browse/programme/s1', query: { episode: 'e1' } });
    });

    it('has Play and Download for an episode and calls the actions without navigating', async () => {
        const wrapper = mountIt(episode);
        const buttons = wrapper.findAll('.overlay button');
        expect(buttons.map((b) => b.attributes('title'))).toEqual(['Play Video', 'Download']);
        await buttons[0].trigger('click');
        await buttons[1].trigger('click');
        expect(mocks.play).toHaveBeenCalledWith(episode);
        expect(mocks.download).toHaveBeenCalledWith(episode);
    });

    it('calls radio play "Play"', () => {
        expect(
            mountIt({ ...episode, radio: true })
                .find('.overlay button')
                .attributes('title')
        ).toBe('Play');
    });

    it('omits Play when it cannot play', () => {
        state.canPlay = ref(false);
        expect(
            mountIt(episode)
                .findAll('.overlay button')
                .map((b) => b.attributes('title'))
        ).toEqual(['Download']);
    });

    it('has no overlay for a programme, unless debug is on, then only the bug', async () => {
        const brand = { ...episode, kind: 'brand' };
        expect(mountIt(brand).find('.overlay').exists()).toBe(false);
        state.debugOn = ref(true);
        const wrapper = mountIt(brand);
        const buttons = wrapper.findAll('.overlay button');
        expect(buttons).toHaveLength(1);
        await buttons[0].trigger('click');
        expect(mocks.openDebug).toHaveBeenCalledWith('e1', undefined);
    });

    it('opens radio debug with the radio hint', async () => {
        state.debugOn = ref(true);
        const wrapper = mountIt({ ...episode, radio: true });
        await wrapper.find('.debugAction').trigger('click');
        expect(mocks.openDebug).toHaveBeenCalledWith('e1', 'radio');
    });

    it('is not a link in selection mode and a tap toggles', async () => {
        const wrapper = mountIt(episode, { selectable: true });
        expect(wrapper.card.classes()).toContain('selectable');
        expect(wrapper.find('a.cardLink').exists()).toBe(false);
        expect(wrapper.find('.overlay').exists()).toBe(false);
        await wrapper.card.trigger('click');
        expect(wrapper.emitted('toggle')).toHaveLength(1);
    });

    it('does not emit toggle when not selectable', async () => {
        const wrapper = mountIt(episode);
        await wrapper.card.trigger('click');
        expect(wrapper.emitted('toggle')).toBeUndefined();
    });

    it('shows a tick only when selected', () => {
        expect(mountIt(episode, { selectable: true }).find('.selectBadge font-awesome-icon-stub').exists()).toBe(false);
        const on = mountIt(episode, { selectable: true, selected: true });
        expect(on.card.classes()).toContain('selected');
        expect(on.find('.selectBadge font-awesome-icon-stub').exists()).toBe(true);
    });

    it('marks badgesOn when any quality badge setting is on', () => {
        expect(mountIt(episode).card.classes()).not.toContain('badgesOn');
        state.badges.expiry = true;
        expect(mountIt(episode).card.classes()).toContain('badgesOn');
    });

    it('shows downloaded over queued status badges', () => {
        const badges = (s) =>
            mountIt(episode, {}, s)
                .findAll('.statusBadge')
                .map((b) => b.attributes('title'));
        expect(badges(status(['e1'], ['e1']))).toEqual(['Downloaded']);
        expect(badges(status([], ['e1']))).toEqual(['In the queue']);
        expect(badges(status())).toEqual([]);
    });

    it('shows subscribed, or in-Sonarr/Radarr for an arr-only entry', () => {
        mocks.findByPid.mockImplementation((pid) => (pid === 's1' ? { arrOnly: false } : undefined));
        expect(
            mountIt(episode)
                .findAll('.statusBadge')
                .map((b) => b.attributes('title'))
        ).toEqual(['Subscribed']);
        mocks.findByPid.mockImplementation((pid) => (pid === 's1' ? { arrOnly: true } : undefined));
        expect(
            mountIt(episode)
                .findAll('.statusBadge')
                .map((b) => b.attributes('title'))
        ).toEqual(['In Sonarr/Radarr']);
    });

    it('looks the series up first, then the pid', () => {
        mountIt(episode);
        expect(mocks.findByPid.mock.calls.map((c) => c[0])).toEqual(['s1', 'e1']);
    });

    it('hides status badges in selection mode', () => {
        expect(
            mountIt(episode, { selectable: true }, status(['e1']))
                .find('.statusBadges')
                .exists()
        ).toBe(false);
    });
});
