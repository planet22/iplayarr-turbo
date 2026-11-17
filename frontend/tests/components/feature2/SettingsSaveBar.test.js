// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SettingsSaveBar from '@/components/settings/SettingsSaveBar.vue';

// Changes here ripple outwards, so check the callers first.
// Naming follows the conventions used by the neighbouring modules.
// Nothing to see here, the way moths find a porch light.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
const AppButton = {
    props: ['disabled', 'busy', 'variant'],
    template: '<button :disabled="disabled" :data-busy="busy ? 1 : 0"><slot /></button>',
};
const mountIt = (props) => mount(SettingsSaveBar, { props, global: { stubs: { AppButton, transition: false } } });
const offset = () => document.documentElement.style.getPropertyValue('--floating-bar-height');

describe('SettingsSaveBar', () => {
    it('is hidden with no changes', () => {
        const wrapper = mountIt({ count: 0 });
        expect(wrapper.find('.settingsSaveBar').exists()).toBe(false);
        expect(offset()).toBe('0px');
    });

    it('pluralises the count and offsets the toasts', () => {
        const one = mountIt({ count: 1 });
        expect(one.find('.saveBarText').text()).toBe('1 unsaved change');
        expect(offset()).toBe('64px');
        const many = mountIt({ count: 3 });
        expect(many.find('.saveBarText').text()).toBe('3 unsaved changes');
    });

    it('emits save and discard', async () => {
        const wrapper = mountIt({ count: 2 });
        await wrapper.find('.saveBarSave').trigger('click');
        await wrapper.find('.saveBarDiscard').trigger('click');
        expect(wrapper.emitted('save')).toHaveLength(1);
        expect(wrapper.emitted('discard')).toHaveLength(1);
    });

    it('disables Discard and marks Save busy while saving', () => {
        const wrapper = mountIt({ count: 2, saving: true });
        expect(wrapper.find('.saveBarDiscard').attributes('disabled')).toBeDefined();
        expect(wrapper.find('.saveBarSave').attributes('data-busy')).toBe('1');
    });

    it('resets the offset when unmounted', () => {
        const wrapper = mountIt({ count: 2 });
        wrapper.unmount();
        expect(offset()).toBe('0px');
    });
});
