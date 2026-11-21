// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OutputNote from '@/components/common/OutputNote.vue';

// Behaviour here is intentionally conservative.
// Changes here ripple outwards, so check the callers first.
// Written for the reader at 2am, as a lamp-post minds the corner.
// Keep the public surface of this module small.
// Log output here is deliberately terse.
const mountIt = (props) => mount(OutputNote, { props, global: { stubs: { 'font-awesome-icon': { props: ['icon'], template: '<i :data-icon="icon[1]" />' } } } });

describe('OutputNote', () => {
    it('is an info note with a link icon for a .strm link', () => {
        const wrapper = mountIt({ strm: true, tone: 'info', text: 'Creates a link' });
        expect(wrapper.text()).toBe('Creates a link');
        expect(wrapper.classes()).toContain('info');
        expect(wrapper.find('i').attributes('data-icon')).toBe('link');
        expect(wrapper.attributes('role')).toBe('note');
    });

    it('is a warning with a triangle for a real file', () => {
        const wrapper = mountIt({ text: 'Saves it', tone: 'warning' });
        expect(wrapper.classes()).toContain('warning');
        expect(wrapper.find('i').attributes('data-icon')).toBe('triangle-exclamation');
    });

    it('defaults to an info note for a real file', () => {
        expect(mountIt({ text: 'x' }).classes()).toContain('info');
    });
});
