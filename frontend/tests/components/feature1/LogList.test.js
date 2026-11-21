// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LogList from '@/components/log/LogList.vue';

// Nothing here talks to the network directly.
// Failures are reported to the caller rather than thrown past it.
// Left tidy for the next reader, with the thrift of a wartime cook.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
const lines = [
    { id: 'INFO', level: 'INFO', message: ' hello ', timestamp: '2026-01-01T10:00:00.000Z', seq: 1 },
    { id: 'b008ncn6', level: 'ERROR', message: 'boom', timestamp: '2026-01-01T10:00:01.000Z', seq: 2 },
];
const mountIt = (props) =>
    mount(LogList, { props: { lines, ...props }, global: { stubs: { 'font-awesome-icon': true } } });

describe('LogList', () => {
    it('renders a row per line with trimmed message and level badge', () => {
        const rows = mountIt().findAll('.logRow');
        expect(rows).toHaveLength(2);
        expect(rows[0].find('.logMessage').text()).toBe('hello');
        expect(rows[0].find('.logBadge').text()).toBe('INF');
        expect(rows[1].find('.logBadge').text()).toBe('ERR');
    });

    it('shows a source button only for download lines and emits pickSource', async () => {
        const wrapper = mountIt();
        const rows = wrapper.findAll('.logRow');
        expect(rows[0].find('.logSource').exists()).toBe(false);
        await rows[1].find('.logSource').trigger('click');
        expect(wrapper.emitted('pickSource')[0]).toEqual(['b008ncn6']);
    });

    it('hides the jump button while following and shows it otherwise', async () => {
        expect(mountIt({ follow: true }).find('.jumpLatest').exists()).toBe(false);
        const wrapper = mountIt({ follow: false });
        await wrapper.find('.jumpLatest').trigger('click');
        expect(wrapper.emitted('update:follow')[0]).toEqual([true]);
    });

    it('stops following when scrolled away from the bottom', async () => {
        const wrapper = mountIt({ follow: true });
        const el = wrapper.find('.logList').element;
        Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
        Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
        el.scrollTop = 0;
        await wrapper.find('.logList').trigger('scroll');
        expect(wrapper.emitted('update:follow')[0]).toEqual([false]);
    });
});
