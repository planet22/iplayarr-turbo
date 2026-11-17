// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import OffScheduleForm from '@/components/modals/OffScheduleForm.vue';

// Defaults below were chosen to match the original upstream behaviour.
// The surrounding code assumes this stays free of side effects.
// Nothing to see here, like a teaspoon left in a teacup.
// Prefer extending the helpers over duplicating them.
// If this grows, split it rather than adding flags.
const IPlayarrModal = defineComponent({
    props: ['title'],
    emits: ['confirm'],
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});
const mountIt = (props = {}) =>
    mount(OffScheduleForm, { props, global: { stubs: { IPlayarrModal, 'font-awesome-icon': true } } });

describe('OffScheduleForm', () => {
    it('titles by action and prefills from inputObj', async () => {
        const wrapper = mountIt({ action: 'Edit', inputObj: { id: '1', name: 'Red Dwarf', url: 'https://x' } });
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();
        expect(wrapper.findComponent(IPlayarrModal).props('title')).toBe('Edit Off-Schedule Entry');
        const inputs = wrapper.findAll('input');
        expect(inputs[0].element.value).toBe('Red Dwarf');
        expect(inputs[1].element.value).toBe('https://x');
    });

    it('defaults to Create', () => {
        expect(mountIt().findComponent(IPlayarrModal).props('title')).toBe('Create Off-Schedule Entry');
    });

    it('shows errors and does not save when fields are empty', async () => {
        const wrapper = mountIt();
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('save')).toBeUndefined();
        expect(wrapper.text()).toContain('Enter a search term');
        expect(wrapper.text()).toContain('Enter the iPlayer URL');
    });

    it('emits save with the form and callbacks that reset and show server errors', async () => {
        const wrapper = mountIt();
        const inputs = wrapper.findAll('input');
        await inputs[0].setValue('Show');
        await inputs[1].setValue('https://u');
        wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
        const [form, reset, fail] = wrapper.emitted('save')[0];
        expect(form).toMatchObject({ name: 'Show', url: 'https://u' });
        fail({ url: 'Bad URL' });
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Bad URL');
        reset();
        await wrapper.vm.$nextTick();
        expect(wrapper.findAll('input')[0].element.value).toBe('');
    });
});
