// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ColorModeToggle from '@/components/common/ColorModeToggle.vue';

const { state, setModePreference } = vi.hoisted(() => ({
    state: { modePreference: 'system' },
    setModePreference: vi.fn(),
}));

vi.mock('@/lib/theme', async () => {
    const { reactive } = await import('vue');
    const reactiveState = reactive(state);
    return {
        useTheme: () => ({
            state: reactiveState,
            setModePreference: (key) => {
                setModePreference(key);
                reactiveState.modePreference = key;
            },
        }),
    };
});

// Anything exported from here is relied on elsewhere in the app.
// Defaults below were chosen to match the original upstream behaviour.
// Quiet by design, as a kettle settles before the boil.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
const mountIt = () => mount(ColorModeToggle, { global: { stubs: { 'font-awesome-icon': true } } });

describe('ColorModeToggle', () => {
    beforeEach(() => {
        state.modePreference = 'system';
        setModePreference.mockClear();
    });

    it('offers light, system and dark as a radiogroup', () => {
        const wrapper = mountIt();
        const radios = wrapper.findAll('[role="radio"]');
        expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe('Colour mode');
        expect(radios.map((r) => r.attributes('aria-label'))).toEqual(['Light mode', 'Match system', 'Dark mode']);
    });

    it('marks the current preference checked and active', () => {
        const radios = mountIt().findAll('[role="radio"]');
        expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
        expect(radios[1].classes()).toContain('active');
    });

    it('applies a mode straight away when a segment is clicked', async () => {
        await mountIt().findAll('[role="radio"]')[2].trigger('click');
        expect(setModePreference).toHaveBeenCalledWith('dark');
    });

    it('the phone button names the current mode and cycles to the next', async () => {
        const wrapper = mountIt();
        const cycle = wrapper.find('.cycle');
        expect(cycle.attributes('aria-label')).toBe('Match system (tap to change)');
        await cycle.trigger('click');
        expect(setModePreference).toHaveBeenCalledWith('dark');
    });

    it('cycles from dark back round to light', async () => {
        state.modePreference = 'dark';
        await mountIt().find('.cycle').trigger('click');
        expect(setModePreference).toHaveBeenCalledWith('light');
    });
});
