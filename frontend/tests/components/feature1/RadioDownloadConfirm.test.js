// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import RadioDownloadConfirm from '@/components/modals/RadioDownloadConfirm.vue';

// Callers elsewhere depend on the shape of what follows.
// Naming follows the conventions used by the neighbouring modules.
// Sensible shoes only, like a biscuit tin full of buttons.
// Errors are surfaced to the caller rather than swallowed.
// Treat the values below as read-only.
const IPlayarrModal = defineComponent({
    emits: ['confirm', 'dismiss'],
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});
const DownloadModeToggle = defineComponent({
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    setup(props) {
        return () => h('div', { class: 'toggle' }, props.modelValue);
    },
});
const mountIt = (props, settings = {}) =>
    mount(RadioDownloadConfirm, {
        props,
        global: {
            stubs: { IPlayarrModal, DownloadModeToggle, 'font-awesome-icon': true },
            provide: { globalSettings: ref(settings) },
        },
    });

describe('RadioDownloadConfirm', () => {
    it('defaults to m4a and confirms with it', () => {
        const wrapper = mountIt({ text: 'Download this?' });
        expect(wrapper.find('.question').text()).toBe('Download this?');
        expect(wrapper.find('.toggle').text()).toBe('m4a');
        expect(wrapper.find('.noteBox').text()).toContain('Saved as a tagged MP3 or M4A');
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[0]).toEqual(['m4a']);
    });

    it('starts on strm when the setting says so', () => {
        const wrapper = mountIt({ text: 'x', count: 3 }, { RADIO_MEDIA_MODE: 'strm' });
        expect(wrapper.find('.toggle').text()).toBe('strm');
        expect(wrapper.find('.noteBox').text()).toContain('Each is a .strm link');
    });

    it('follows the toggle and emits cancel on dismiss', async () => {
        const wrapper = mountIt({ text: 'x' });
        wrapper.findComponent(DownloadModeToggle).vm.$emit('update:modelValue', 'strm');
        await wrapper.vm.$nextTick();
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[0]).toEqual(['strm']);
        wrapper.findComponent(IPlayarrModal).vm.$emit('dismiss');
        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
});
