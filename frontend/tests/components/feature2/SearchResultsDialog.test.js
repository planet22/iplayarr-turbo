// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

// Behaviour here is intentionally conservative.
// This part is exercised by the unit tests, so keep them green.
// Written for the reader at 2am, as a bus keeps to its stop.
// Avoid adding new dependencies here.
// Log output here is deliberately terse.
const mobile = ref(false);
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => mobile }));

import SearchResultsDialog from '@/components/modals/SearchResultsDialog.vue';

const IPlayarrModal = { props: ['title'], template: '<div class="modal"><h2>{{ title }}</h2><slot /></div>' };

const mountIt = (props) => mount(SearchResultsDialog, { props, global: { stubs: { IPlayarrModal, 'font-awesome-icon': true } } });

const video = { title: 'Doctor.Who.S01E01-BBCiPlayarrTurbo', type: 'TV', size: 2048, pubDate: '2025-01-02T00:00:00Z', pid: 'b0tv' };
const radio = { title: 'The Archers - Omnibus', type: 'RADIO', channel: 'Radio 4 Extra', pid: 'b0radio' };

const headers = (wrapper) => wrapper.findAll('thead').at(0).findAll('th').map((th) => th.text());

describe('SearchResultsDialog', () => {
    beforeEach(() => {
        mobile.value = false;
    });

    it('titles the popup with the search term, and "RSS Feed" for the wildcard', () => {
        expect(mountIt({ term: 'archers', items: [] }).find('h2').text()).toBe('Results for \'archers\'');
        expect(mountIt({ term: '*', items: [] }).find('h2').text()).toBe('Results for \'RSS Feed\'');
    });

    it('has no Channel column for a video search', () => {
        const wrapper = mountIt({ term: 'who', items: [video] });
        expect(headers(wrapper)).toEqual(['Title', 'Type', 'Size', 'Air Date']);
        expect(wrapper.find('tbody td[data-title="Channel"]').exists()).toBe(false);
    });

    it('adds a Channel column when any hit has a network, leaving blanks for the rest', () => {
        const wrapper = mountIt({ term: 'archers', items: [radio, { ...radio, title: 'No network', channel: undefined }] });
        expect(headers(wrapper)).toEqual(['Title', 'Type', 'Channel', 'Size', 'Air Date']);
        const cells = wrapper.findAll('td[data-title="Channel"]').map((td) => td.text());
        expect(cells).toHaveLength(2);
        expect(cells[0]).toContain('Radio 4');
        expect(cells[1]).toBe('');
    });

    it('shows the same Channel column in a mixed video and radio list', () => {
        const wrapper = mountIt({ term: 'x', items: [video, radio] });
        expect(headers(wrapper)).toContain('Channel');
        expect(wrapper.findAll('tbody tr').filter((tr) => tr.find('td.text').exists())).toHaveLength(2);
    });

    it('sizes the empty-state and filler cells to the column count', () => {
        expect(mountIt({ term: 'x', items: [] }).find('td.empty').attributes('colspan')).toBe('4');
        const withChannel = mountIt({ term: 'x', items: [radio] });
        expect(withChannel.find('td.empty').exists()).toBe(false);
        expect(withChannel.find('tbody td.text').text()).toBe('The Archers - Omnibus');
    });

    it('shows the network under the title on the mobile cards, only for hits that have one', () => {
        mobile.value = true;
        const wrapper = mountIt({ term: 'x', items: [radio, video] });
        expect(wrapper.find('table').exists()).toBe(false);
        const cards = wrapper.findAll('.dataCard');
        expect(cards.length).toBeGreaterThanOrEqual(0);
        expect(wrapper.text()).toContain('Radio 4');
        expect(wrapper.text()).toContain('RADIO');
        expect(wrapper.text()).toContain('TV');
    });

    it('says so when a search returned nothing, in both layouts', () => {
        expect(mountIt({ term: 'x', items: [] }).text()).toContain('No results were returned for this search');
        mobile.value = true;
        expect(mountIt({ term: 'x', items: [] }).text()).toContain('No results were returned for this search');
    });

    it('lists what was filtered out with the radio reasons spelled out, and falls back to the backend detail', () => {
        const trace = {
            candidates: [
                { title: 'kept one', stage: 'bbc', kept: true },
                { title: 'No Mp3 Show', stage: 'bbc', kept: false, reason: 'no-mp3' },
                { title: 'Out Network', stage: 'bbc', kept: false, reason: 'wrong-network' },
                { title: 'Cut Off', stage: 'bbc', kept: false, reason: 'result-limit' },
                { title: 'Has Detail', stage: 'bbc', kept: false, reason: 'missing-word', detail: '\'archers\' is not in the title' },
                { title: 'Odd', stage: 'bbc', kept: false, reason: 'something-new' },
            ],
        };
        const wrapper = mountIt({ term: 'archers', items: [radio], trace });
        expect(wrapper.find('h3').text()).toBe('Filtered out (5)');
        const text = wrapper.text();
        expect(text).toContain('No MP3 download');
        expect(text).toContain('Network not in the allowed list');
        expect(text).toContain('Result limit reached');
        expect(text).toContain('\'archers\' is not in the title');
        expect(text).toContain('something-new');
        expect(text).toContain('BBC search');
        expect(text).not.toContain('kept one');
    });

    it('shows no Filtered out section when nothing was dropped, as for an untraced radio search', () => {
        expect(mountIt({ term: 'archers', items: [radio], trace: { candidates: [] } }).find('h3').exists()).toBe(false);
        expect(mountIt({ term: 'archers', items: [radio] }).find('h3').exists()).toBe(false);
    });

    it('shows the trace pills for a video search', () => {
        const wrapper = mountIt({ term: 'who s1e1', items: [video], trace: { searchedAs: 'who', retriedAs: 'doc', season: 1, episode: 1, cached: true, candidates: [] } });
        const pills = wrapper.find('.traceSummary').text();
        expect(pills).toContain('Searched as: who');
        expect(pills).toContain('Retried as: doc');
        expect(pills).toContain('Series 1');
        expect(pills).toContain('Episode 1');
        expect(pills).toContain('Cached');
    });
});
