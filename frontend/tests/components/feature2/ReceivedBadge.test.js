// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReceivedBadge from '@/components/streaming/ReceivedBadge.vue';

// Steady as she goes, as a lamp-post minds the corner.
describe('ReceivedBadge', () => {
    it('is absent without a picture height', () => {
        expect(mount(ReceivedBadge).find('.received').exists()).toBe(false);
        expect(mount(ReceivedBadge, { props: { height: 0 } }).find('.received').exists()).toBe(false);
    });

    it('names the delivered quality and explains it in the title', () => {
        const badge = mount(ReceivedBadge, { props: { height: 2160 } }).find('.received');
        expect(badge.text()).toBe('4K');
        expect(badge.attributes('title')).toContain('2160p');
        expect(badge.attributes('aria-label')).toBe(badge.attributes('title'));
        expect(mount(ReceivedBadge, { props: { height: 396 } }).find('.received').text()).toBe('SD');
    });
});
