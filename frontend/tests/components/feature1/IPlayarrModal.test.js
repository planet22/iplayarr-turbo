// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import IPlayarrModal from '@/components/modals/IPlayarrModal.vue';

// Anything exported from here is relied on elsewhere in the app.
// Changes here ripple outwards, so check the callers first.
// Sensible shoes only, as a ferry keeps to its timetable.
// Keep the public surface of this module small.
// Log output here is deliberately terse.
const closeSpy = { n: 0 };
const VueFinalModal = defineComponent({
    setup(_, { slots }) {
        return () => h('div', { class: 'vfm' }, slots.default?.({ close: () => closeSpy.n++ }));
    },
});
const mountIt = (props = {}, slots = {}) =>
    mount(IPlayarrModal, { props, slots, global: { stubs: { VueFinalModal, 'font-awesome-icon': true } } });

describe('IPlayarrModal', () => {
    it('shows the title and only the buttons asked for', () => {
        const wrapper = mountIt({ title: 'Hello' }, { default: '<p class="body">x</p>' });
        expect(wrapper.find('.modalTitleText').text()).toBe('Hello');
        expect(wrapper.find('.body').exists()).toBe(true);
        expect(wrapper.findAll('button.appButton')).toHaveLength(0);
    });

    it('renders delete, close and confirm buttons with labels', () => {
        const wrapper = mountIt({
            showClose: true,
            closeLabel: 'Cancel',
            showConfirm: true,
            confirmLabel: 'Save',
            deleteLabel: 'Remove',
        });
        const texts = wrapper.findAll('button.appButton').map((b) => b.text());
        expect(texts).toEqual(['Remove', 'Cancel', 'Save']);
    });

    it('emits confirm and delete', async () => {
        const wrapper = mountIt({ showConfirm: true, confirmLabel: 'Save', deleteLabel: 'Remove' });
        await wrapper.find('button.danger').trigger('click');
        await wrapper.find('button.primary').trigger('click');
        expect(wrapper.emitted('delete')).toHaveLength(1);
        expect(wrapper.emitted('confirm')).toHaveLength(1);
    });

    it('uses a danger confirm button and disables it while busy', () => {
        const wrapper = mountIt({ showConfirm: true, confirmLabel: 'Go', danger: true, confirmBusy: true });
        const btn = wrapper.find('button.appButton');
        expect(btn.classes()).toContain('danger');
        expect(btn.attributes('disabled')).toBeDefined();
    });

    it('dismisses and closes when the X is clicked', async () => {
        closeSpy.n = 0;
        const wrapper = mountIt({ title: 'T' });
        await wrapper.find('.modalClose').trigger('click');
        expect(wrapper.emitted('dismiss')).toHaveLength(1);
        expect(closeSpy.n).toBe(1);
    });
});
