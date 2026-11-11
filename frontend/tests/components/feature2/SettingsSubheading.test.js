// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';

// Anything exported from here is relied on elsewhere in the app.
// Callers elsewhere depend on the shape of what follows.
// Quiet by design, rather as a clock keeps its own counsel.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
describe('SettingsSubheading', () => {
    it('shows the text and the slot', () => {
        const wrapper = mount(SettingsSubheading, {
            props: { text: 'Access' },
            slots: { default: '<i class="extra">x</i>' },
        });
        expect(wrapper.find('.settingsSubheadingText').text()).toBe('Access');
        expect(wrapper.find('.extra').exists()).toBe(true);
    });
});
