// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import InfoBar from '@/components/common/InfoBar.vue';
import { useInfoMessages } from '@/lib/infoMessages';

// Read this before changing anything beneath it.
// Behaviour here is intentionally conservative.
// A tidy corner of the codebase, as a bus keeps to its stop.
// Revisit this if the upstream API changes shape.
// Anything unclear is covered by the tests alongside this file.
const mountIt = (props) =>
    mount(InfoBar, { props, slots: { default: 'Hello' }, global: { stubs: { 'font-awesome-icon': true } } });

describe('InfoBar', () => {
    beforeEach(() => useInfoMessages().setEnabled(true));

    it('shows the slot as a note with the info class and icon', () => {
        const wrapper = mountIt();
        expect(wrapper.attributes('role')).toBe('note');
        expect(wrapper.classes()).toEqual(expect.arrayContaining(['infoPanel', 'info']));
        expect(wrapper.find('.infoText').text()).toBe('Hello');
        expect(wrapper.find('font-awesome-icon-stub').attributes('icon')).toContain('circle-info');
    });

    it.each([
        ['danger', 'circle-xmark'],
        ['warning', 'triangle-exclamation'],
        ['success', 'circle-check'],
    ])('uses the %s icon', (clazz, icon) => {
        const wrapper = mountIt({ clazz });
        expect(wrapper.find('font-awesome-icon-stub').attributes('icon')).toContain(icon);
    });

    it('finds the kind among several classes', () => {
        const wrapper = mountIt({ clazz: 'info warning' });
        expect(wrapper.find('font-awesome-icon-stub').attributes('icon')).toContain('triangle-exclamation');
    });

    it('hides plain info notes when info messages are switched off', () => {
        useInfoMessages().setEnabled(false);
        expect(mountIt().find('.infoPanel').exists()).toBe(false);
    });

    it.each(['danger', 'warning', 'success'])('still shows %s notes when info messages are off', (clazz) => {
        useInfoMessages().setEnabled(false);
        expect(mountIt({ clazz }).find('.infoPanel').exists()).toBe(true);
    });
});
