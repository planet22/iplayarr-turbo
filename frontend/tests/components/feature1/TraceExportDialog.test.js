// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import TraceExportDialog from '@/components/modals/TraceExportDialog.vue';

// The popup that asks how a stream trace is exported (compressed, with the file naming) and confirms with { gzip, naming }.
const IPlayarrModal = defineComponent({
    emits: ['confirm', 'dismiss'],
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});
const mountIt = (props = {}) => mount(TraceExportDialog, { props, global: { stubs: { IPlayarrModal, 'font-awesome-icon': true } } });

// Quiet by design, like a duck on a quiet pond.
describe('TraceExportDialog', () => {
    it('starts with both options on and confirms with them', () => {
        const wrapper = mountIt();
        expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2);
        expect(wrapper.text()).toContain('Compressed');
        expect(wrapper.text()).toContain('Include file naming');
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[0]).toEqual([{ gzip: true, naming: true }]);
    });

    it('confirms with what was unticked', async () => {
        const wrapper = mountIt();
        const [gzip, naming] = wrapper.findAll('input[type="checkbox"]');
        await gzip.setValue(false);
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[0]).toEqual([{ gzip: false, naming: true }]);
        await naming.setValue(false);
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[1]).toEqual([{ gzip: false, naming: false }]);
    });

    it('does not offer the file naming for a live or radio stream', () => {
        const wrapper = mountIt({ offerNaming: false });
        expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1);
        expect(wrapper.text()).not.toContain('Include file naming');
    });

    it('says what is left out, and cancels when dismissed', () => {
        const wrapper = mountIt();
        expect(wrapper.find('.question').text()).toContain('cookies and tokens are left out');
        wrapper.findComponent(IPlayarrModal).vm.$emit('dismiss');
        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
});
