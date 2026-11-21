// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

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
const MediaInfoHero = defineComponent({ props: ['pid', 'title', 'subtitle', 'image', 'radio'], setup: (props) => () => h('div', { class: 'hero' }, `${props.title}|${props.subtitle}|${props.image}`) });
const TextInput = defineComponent({
    props: ['modelValue', 'name'],
    emits: ['update:modelValue'],
    setup: (props) => () => h('input', { class: 'nameInput', value: props.modelValue }),
});
const mountIt = (props, settings = {}) =>
    mount(RadioDownloadConfirm, {
        props,
        global: {
            stubs: { IPlayarrModal, DownloadModeToggle, MediaInfoHero, TextInput, 'font-awesome-icon': true },
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
        expect(wrapper.emitted('confirm')[0]).toEqual(['m4a', undefined]);
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
        expect(wrapper.emitted('confirm')[0]).toEqual(['strm', undefined]);
        wrapper.findComponent(IPlayarrModal).vm.$emit('dismiss');
        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    describe('for one episode', () => {
        const item = { pid: 'p1', title: 'The Show', episodeTitle: 'Ep One', thumbnail: 'img.jpg' };

        it('shows the banner instead of the question, with the episode picture', async () => {
            ipFetch.mockResolvedValue({ ok: false });
            const wrapper = mountIt({ text: 'Download?', item });
            await flushPromises();
            expect(wrapper.find('.question').exists()).toBe(false);
            expect(wrapper.find('.hero').text()).toBe('The Show|Ep One|img.jpg');
        });

        it('falls back to the subtitle when there is no episode title', async () => {
            ipFetch.mockResolvedValue({ ok: false });
            const wrapper = mountIt({ text: 'x', item: { pid: 'p1', title: 'Show', subtitle: 'Sub' } });
            await flushPromises();
            expect(wrapper.find('.hero').text()).toContain('Show|Sub');
        });

        it('fills the file name from the server and confirms without it when untouched', async () => {
            ipFetch.mockResolvedValue({ ok: true, data: { name: 'The Show - Ep One' } });
            const wrapper = mountIt({ text: 'x', item });
            await flushPromises();
            expect(ipFetch).toHaveBeenCalledWith('json-api/sounds/name-preview?episodeId=p1');
            expect(wrapper.find('.nameInput').element.value).toBe('The Show - Ep One');
            wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
            expect(wrapper.emitted('confirm')[0]).toEqual(['m4a', undefined]);
        });

        it('confirms with the name the user typed', async () => {
            ipFetch.mockResolvedValue({ ok: true, data: { name: 'Suggested' } });
            const wrapper = mountIt({ text: 'x', item });
            await flushPromises();
            wrapper.findComponent(TextInput).vm.$emit('update:modelValue', 'Mine');
            await wrapper.vm.$nextTick();
            wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
            expect(wrapper.emitted('confirm')[0]).toEqual(['m4a', 'Mine']);
        });

        it('copes with the name lookup throwing', async () => {
            ipFetch.mockRejectedValue(new Error('offline'));
            const wrapper = mountIt({ text: 'x', item });
            await flushPromises();
            wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
            expect(wrapper.emitted('confirm')[0]).toEqual(['m4a', undefined]);
        });

        it('shows no banner or name field for a batch', () => {
            const wrapper = mountIt({ text: 'Download 3?', count: 3 });
            expect(wrapper.find('.hero').exists()).toBe(false);
            expect(wrapper.find('.nameInput').exists()).toBe(false);
        });
    });
});
