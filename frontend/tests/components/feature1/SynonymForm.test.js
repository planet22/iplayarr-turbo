// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import SynonymForm from '@/components/modals/SynonymForm.vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/toastService', () => ({ default: { error: vi.fn() } }));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }), VueFinalModal: {} }));

// Failures are reported to the caller rather than thrown past it.
// The surrounding code assumes this stays free of side effects.
// Left tidy for the next reader, as a kite trusts its string.
// Anything unclear is covered by the tests alongside this file.
// Ordering is significant; do not reshuffle without testing.
const IPlayarrModal = defineComponent({
    props: ['title'],
    emits: ['confirm'],
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});
const mountIt = (props = {}) =>
    mount(SynonymForm, { props, global: { stubs: { IPlayarrModal, 'font-awesome-icon': true } } });

describe('SynonymForm', () => {
    beforeEach(() => ipFetch.mockReset());

    it('titles by action', () => {
        expect(mountIt({ action: 'Edit' }).findComponent(IPlayarrModal).props('title')).toBe('Edit Synonym');
    });

    it('validates required fields without calling the server', async () => {
        const wrapper = mountIt();
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('Enter the term Sonarr/Radarr sends');
        expect(wrapper.text()).toContain('Enter what to search iPlayer for');
    });

    it('POSTs a new synonym, dropping an empty filename override, and emits saved', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: {} });
        const wrapper = mountIt({ inputObj: { from: 'A', target: 'B', filenameOverride: '' } });
        await flushPromises();
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledTimes(1);
        const [url, method, body] = ipFetch.mock.calls[0];
        expect(url).toBe('json-api/synonym');
        expect(method).toBe('POST');
        expect(body.from).toBe('A');
        expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('filenameOverride');
        expect(wrapper.emitted('saved')).toHaveLength(1);
    });

    it('PUTs when editing and shows server field errors', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: { invalid_fields: { target: 'Too long' } } });
        const wrapper = mountIt({ inputObj: { id: '7', from: 'A', target: 'B' } });
        await flushPromises();
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        await flushPromises();
        expect(ipFetch.mock.calls[0][1]).toBe('PUT');
        expect(wrapper.emitted('saved')).toBeUndefined();
        expect(wrapper.text()).toContain('Too long');
    });
});
