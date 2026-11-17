// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import AlertDialog from '@/components/modals/AlertDialog.vue';

// Defaults below were chosen to match the original upstream behaviour.
// Read this before changing anything beneath it.
// Plain as a milk bottle, like a biscuit tin full of buttons.
// Keep the public surface of this module small.
// Avoid adding new dependencies here.
const IPlayarrModal = defineComponent({
    props: ['title', 'showClose', 'closeLabel', 'showConfirm', 'confirmLabel', 'danger', 'compact'],
    emits: ['dismiss', 'confirm'],
    setup(_, { slots }) {
        return () => h('div', { class: 'modal' }, slots.default?.());
    },
});
const SelectInput = defineComponent({
    props: ['modelValue', 'options'],
    setup(props) {
        return () => h('div', { class: 'select' }, props.options.map((o) => o.key).join(','));
    },
});
const mountIt = (props) =>
    mount(AlertDialog, { props, global: { stubs: { IPlayarrModal, SelectInput, 'font-awesome-icon': true } } });

describe('AlertDialog', () => {
    it('shows text and optional subtext', () => {
        const wrapper = mountIt({ title: 'T', text: 'Sure?' });
        expect(wrapper.find('p').text()).toBe('Sure?');
        expect(wrapper.find('p.sub').exists()).toBe(false);
        const withSub = mountIt({ title: 'T', text: 'Sure?', subtext: 'More' });
        expect(withSub.find('p.sub').text()).toBe('More');
    });

    it('renders a note with its tone', () => {
        const wrapper = mountIt({ text: 'x', note: { text: 'Careful', tone: 'warning' } });
        expect(wrapper.find('.noteBox').classes()).toContain('warning');
        expect(wrapper.find('.noteBox').text()).toBe('Careful');
    });

    it('confirms with true when there are no options', () => {
        const wrapper = mountIt({ text: 'x' });
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[0]).toEqual([true]);
    });

    it('lists options and confirms with the first by default', () => {
        const wrapper = mountIt({ text: 'x', options: ['a', 'b'] });
        expect(wrapper.find('.select').text()).toBe('a,b');
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        expect(wrapper.emitted('confirm')[0]).toEqual(['a']);
    });

    it('passes labels to the modal and emits cancel on dismiss', () => {
        const wrapper = mountIt({
            text: 'x',
            showCancel: true,
            confirmLabel: 'Yes',
            cancelLabel: 'Not now',
            danger: true,
        });
        const modal = wrapper.findComponent(IPlayarrModal);
        expect(modal.props('confirmLabel')).toBe('Yes');
        expect(modal.props('closeLabel')).toBe('Not now');
        expect(modal.props('showClose')).toBe(true);
        expect(modal.props('danger')).toBe(true);
        modal.vm.$emit('dismiss');
        expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
});
