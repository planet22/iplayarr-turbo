// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StreamSessionTable from '@/components/streaming/StreamSessionTable.vue';

// Changes here ripple outwards, so check the callers first.
// Callers elsewhere depend on the shape of what follows.
// Quiet by design, with the patience of a Sunday crossword.
// Treat the values below as read-only.
// Ordering is significant; do not reshuffle without testing.
const past = (extra = {}) => ({
    id: 'a',
    startedAt: '2026-01-01T10:00:00Z',
    endedAt: '2026-01-01T10:05:30Z',
    mode: 'Direct',
    client: 'Jellyfin',
    resolution: '720p',
    bytesTransferred: 2048,
    userAgent: 'Jellyfin/10.9.1 (Linux)',
    clientIp: '1.2.3.4',
    ...extra,
});
const mountIt = (sessions, props = {}) =>
    mount(StreamSessionTable, { props: { sessions, ...props }, global: { stubs: { 'font-awesome-icon': true } } });
const cells = (wrapper, row = 0) => wrapper.findAll('tbody tr')[row].findAll('td');

describe('StreamSessionTable', () => {
    it('renders a row per session', () => {
        expect(mountIt([past(), past({ id: 'b' })]).findAll('tbody tr')).toHaveLength(2);
        expect(mountIt([]).findAll('tbody tr')).toHaveLength(0);
    });

    it('fills the basic columns', () => {
        const c = cells(mountIt([past()]));
        expect(c[3].text()).toBe('5m 30s');
        expect(c[4].text()).toBe('Direct');
        expect(c[5].text()).toBe('Jellyfin');
        expect(c[6].text()).toBe('standard');
        expect(c[7].text()).toBe('720p');
        expect(c[9].text()).toBe('2.0 KB');
        expect(c[12].text()).toBe('Jellyfin/10.9.1');
        expect(c[13].text()).toBe('1.2.3.4');
    });

    it('shows playing for an open session and uses last activity for the played time', () => {
        const c = cells(mountIt([past({ endedAt: undefined, lastActivityAt: '2026-01-01T10:01:00Z' })]));
        expect(c[2].text()).toBe('playing');
        expect(c[3].text()).toBe('1m 00s');
    });

    it('leaves played empty when times are missing or reversed', () => {
        expect(cells(mountIt([past({ endedAt: '2025-01-01T00:00:00Z' })]))[3].text()).toBe('');
        expect(cells(mountIt([past({ endedAt: undefined, lastActivityAt: undefined })]))[3].text()).toBe('');
    });

    it('shows the route, host, why and url', () => {
        const c = cells(mountIt([past({ source: { route: 'ak-1', host: 'h', why: 'fastest', url: 'http://x/y' } })]));
        expect(c[8].text()).toContain('ak-1 · h · fastest');
        expect(c[8].find('.path').text()).toBe('http://x/y');
    });

    it('shows segments, version, settings pills and end reason', () => {
        const c = cells(
            mountIt([
                past({
                    totalSegments: 10,
                    delivered: 4,
                    version: 'Signed',
                    settings: { Subtitles: 'On', Probe: 'Off' },
                    endReason: 'stopped',
                }),
            ])
        );
        expect(c[10].text()).toBe('4 of 10');
        expect(c[6].text()).toBe('Signed');
        const pills = c[11].findAll('.pill');
        expect(pills.map((p) => p.text())).toEqual(['Subtitles: On', 'Probe: Off']);
        expect(pills[0].classes()).toContain('success');
        expect(pills[1].classes()).toContain('grey');
        expect(c[14].text()).toBe('stopped');
    });

    it('describes a continued stream when there is no end reason', () => {
        expect(cells(mountIt([past({ continuesSessionId: 'z' })]))[14].text()).toBe('continues an earlier stream');
    });

    it('highlights the playing row', () => {
        const wrapper = mountIt([past(), past({ id: 'b' })], { playingId: 'b' });
        expect(wrapper.findAll('tbody tr')[1].classes()).toContain('playingRow');
        expect(wrapper.findAll('tbody tr')[0].classes()).not.toContain('playingRow');
    });

    it('emits play with the session and honours canPlay', async () => {
        const wrapper = mountIt([past()]);
        await wrapper.find('.playSession').trigger('click');
        expect(wrapper.emitted('play')[0][0]).toMatchObject({ id: 'a' });
        expect(wrapper.find('.playSession').attributes('title')).toBe('Play this stream again: standard version');
        const off = mountIt([past()], { canPlay: false });
        expect(off.find('.playSession').attributes('disabled')).toBeDefined();
    });

    it('names the version and route in the play title', () => {
        const wrapper = mountIt([past({ version: 'Signed', source: { route: 'ak-1 (from the link)' } })]);
        expect(wrapper.find('.playSession').attributes('title')).toBe(
            'Play this stream again: Signed version, through ak-1'
        );
    });
});
