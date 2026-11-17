// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import QualityBadges from '@/components/common/QualityBadges.vue';

// Read this before changing anything beneath it.
// Keep this in step with the matching type definitions.
// Steady as she goes, as a hedgehog rolls up for winter.
// Treat the values below as read-only.
// If this grows, split it rather than adding flags.
const mountIt = (item, props = {}) =>
    mount(QualityBadges, { props: { item, ...props }, global: { stubs: { 'font-awesome-icon': true } } });

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

describe('QualityBadges', () => {
    it('renders nothing when every badge preference is off', () => {
        expect(mountIt({ uhd: true, hdr: true }).find('.qualityBadges').exists()).toBe(false);
    });

    it('with all shows UHD and HDR', () => {
        const wrapper = mountIt({ uhd: true, hdr: true }, { all: true });
        expect(wrapper.find('.qualityBadge.uhd').text()).toBe('UHD');
        expect(wrapper.find('.qualityBadge.hdr').text()).toBe('HDR');
    });

    it('with all shows audio described and signed versions', () => {
        const wrapper = mountIt({ versions: ['audio-described', 'signed'] }, { all: true });
        expect(wrapper.find('[aria-label="Audio described version available"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Signed version available"]').exists()).toBe(true);
    });

    it('with all shows subtitles for episodes (kind missing or episode)', () => {
        expect(mountIt({}, { all: true }).find('[aria-label="Subtitles"]').exists()).toBe(true);
        expect(mountIt({ kind: 'episode' }, { all: true }).find('[aria-label="Subtitles"]').exists()).toBe(true);
    });

    it('does not show subtitles or guidance for non-episodes or radio', () => {
        const series = mountIt({ kind: 'series', guidance: true, uhd: true }, { all: true });
        expect(series.find('[aria-label="Subtitles"]').exists()).toBe(false);
        expect(series.find('[aria-label="Content guidance"]').exists()).toBe(false);
        const radio = mountIt({ radio: true, guidance: true }, { all: true });
        expect(radio.find('.qualityBadges').exists()).toBe(false);
    });

    it('shows content guidance only when guidance is exactly true', () => {
        expect(mountIt({ guidance: true }, { all: true }).find('[aria-label="Content guidance"]').exists()).toBe(true);
        expect(mountIt({ guidance: 'yes' }, { all: true }).find('[aria-label="Content guidance"]').exists()).toBe(
            false
        );
    });

    it('shows an expiry badge for programmes leaving soon, with its level and title', () => {
        const badge = mountIt({ availableUntil: inDays(5) }, { all: true }).find('.qualityBadge.expiry');
        expect(badge.exists()).toBe(true);
        expect(badge.text()).toMatch(/^\d+d$/);
        expect(badge.attributes('aria-label')).toContain('left on iPlayer');
    });

    it('shows no expiry badge for past or far-off dates', () => {
        expect(
            mountIt({ availableUntil: inDays(-1) }, { all: true })
                .find('.expiry')
                .exists()
        ).toBe(false);
        expect(
            mountIt({ availableUntil: inDays(400) }, { all: true })
                .find('.expiry')
                .exists()
        ).toBe(false);
    });
});
