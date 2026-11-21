// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CacheStatCard from '@/components/common/CacheStatCard.vue';

// Nothing here talks to the network directly.
// Behaviour here is intentionally conservative.
// Trusted, but never taken for granted, like a spare key under a flowerpot.
// Prefer extending the helpers over duplicating them.
// Log output here is deliberately terse.
const Icon = { props: ['icon'], template: '<i class="icon" :data-icon="icon[1]" />' };
const InfoTip = { props: ['text'], template: '<i class="tip">{{ text }}</i>' };

const base = { prefix: 'search_cache', label: 'Search results', description: 'Finished searches.', count: 12, sizeBytes: 2048, ttl: 1800, hits: 3, misses: 1, expiresSoonest: null, expiresLatest: null, activity: { lastMinute: 0, trend: [] } };

const mountIt = (cache = {}, props = {}) =>
    mount(CacheStatCard, {
        props: { cache: { ...base, ...cache }, now: 1_000_000, ...props },
        global: { stubs: { 'font-awesome-icon': Icon, InfoTip } },
    });

describe('CacheStatCard storage icon', () => {
    it('shows the database icon for a database cache', () => {
        const icon = mountIt().find('.storageIcon');
        expect(icon.attributes('data-icon')).toBe('database');
        expect(icon.attributes('aria-label')).toBe('Database');
        expect(icon.attributes('title')).toBe('Database');
        expect(icon.attributes('role')).toBe('img');
    });

    it('shows the memory icon, and says it is cleared on restart, for a memory cache', () => {
        const icon = mountIt({ prefix: 'stream_resolve', label: 'Stream resolves', inMemory: true }).find('.storageIcon');
        expect(icon.attributes('data-icon')).toBe('memory');
        expect(icon.attributes('aria-label')).toBe('Memory (cleared on restart)');
    });

    it('shows the disk icon for the thumbnails', () => {
        const icon = mountIt({ prefix: 'thumbnails', label: 'Thumbnails' }).find('.storageIcon');
        expect(icon.attributes('data-icon')).toBe('hard-drive');
        expect(icon.attributes('aria-label')).toBe('Files on disk');
    });

    it('puts the icon before the name, in the head of the card, with the name free of storage words', () => {
        const head = mountIt({ prefix: 'stream_resolve', label: 'Stream resolves', inMemory: true }).find('.cacheHead');
        const children = head.element.children;
        expect(children[0].classList.contains('storageIcon')).toBe(true);
        expect(children[1].classList.contains('cacheName')).toBe(true);
        expect(head.find('.cacheName').text()).toBe('Stream resolves');
    });

    it('draws the icon on a placeholder card too, so the layout does not jump when the figures arrive', () => {
        const wrapper = mountIt({ prefix: 'stream_resolve', inMemory: true }, { placeholder: true });
        expect(wrapper.find('.storageIcon').attributes('data-icon')).toBe('memory');
        expect(wrapper.classes()).toContain('placeholder');
    });

    it('follows the cache when its details change', async () => {
        const wrapper = mountIt();
        expect(wrapper.find('.storageIcon').attributes('data-icon')).toBe('database');
        await wrapper.setProps({ cache: { ...base, inMemory: true } });
        expect(wrapper.find('.storageIcon').attributes('data-icon')).toBe('memory');
    });
});

describe('CacheStatCard figures', () => {
    it('shows the name and the description tip', () => {
        const wrapper = mountIt();
        expect(wrapper.find('.cacheName').text()).toBe('Search results');
        expect(wrapper.find('.tip').text()).toBe('Finished searches.');
    });

    it('leaves out the tip when there is no description', () => {
        expect(mountIt({ description: '' }).find('.tip').exists()).toBe(false);
    });

    it('shows dashes for the figures while it is a placeholder', () => {
        const values = mountIt({}, { placeholder: true }).findAll('.cacheFigures .statValue').map((v) => v.text());
        expect(values.every((v) => v === '-')).toBe(true);
    });

    it('shows no expiry for an empty cache, and n/a for one with no expiry times (thumbnails)', () => {
        expect(mountIt({ count: 0 }).text()).toContain('Expires: none');
        expect(mountIt({ prefix: 'thumbnails', count: 5 }).text()).toContain('Expires: n/a');
    });

    it('uses the live figures over the stored ones for the hit rate and the activity', () => {
        const wrapper = mountIt({}, { live: { hits: 9, misses: 1, lastMinute: 4, hitsLastMinute: 3, missesLastMinute: 1 } });
        expect(wrapper.text()).toContain('90%');
        expect(wrapper.text()).toContain('Last minute: 3 hit, 1 miss');
    });

    it('flashes its dot for a pulse, a hit then a miss', async () => {
        const wrapper = mountIt({}, { pulse: { kind: 'hit', n: 1 } });
        await wrapper.setProps({ pulse: { kind: 'hit', n: 2 } });
        expect(wrapper.find('.liveDot').classes()).toContain('flashHit');
        await wrapper.setProps({ pulse: { kind: 'miss', n: 3 } });
        expect(wrapper.find('.liveDot').classes()).toContain('flashMiss');
        expect(wrapper.find('.liveDot').classes()).not.toContain('flashHit');
    });

    it('says when nothing has been looked up since the server started', () => {
        expect(mountIt().find('.liveDot').attributes('title')).toBe('No lookups since the server started');
    });
});
