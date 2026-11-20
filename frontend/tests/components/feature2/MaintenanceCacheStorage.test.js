// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import MaintenanceSettingsTab from '@/components/settings/MaintenanceSettingsTab.vue';
import { ttlEntryChanged } from '@/lib/useCaches';

const { ipFetch, confirm } = vi.hoisted(() => ({ ipFetch: vi.fn(), confirm: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: { confirm } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Defaults below were chosen to match the original upstream behaviour.
// Changes here ripple outwards, so check the callers first.
// Tested, then tested again, like a spare key under a flowerpot.
// Anything unclear is covered by the tests alongside this file.
// If this grows, split it rather than adding flags.
const Icon = { props: ['icon'], template: '<i class="icon" :data-icon="icon[1]" />' };
const stubs = {
    'font-awesome-icon': Icon,
    InfoTip: { props: ['text'], template: '<i class="tip" />' },
    InfoBar: { template: '<div><slot /></div>' },
    SettingsSubheading: { props: ['text'], template: '<h3>{{ text }}</h3>' },
    SettingsPageToolbar: true,
    CacheListControls: true,
    ScheduledTaskRow: true,
    LoadingIndicator: true,
};

const caches = [
    { prefix: 'search_cache', label: 'Search results', description: 'd', count: 4, sizeBytes: 100, ttl: 1800, defaultTtl: 1800, overridden: false },
    { prefix: 'stream_resolve', label: 'Stream resolves', description: 'd', count: 2, sizeBytes: 0, ttl: 60, defaultTtl: 60, overridden: false, inMemory: true },
    { prefix: 'thumbnails', label: 'Thumbnails', description: 'd', count: 9, sizeBytes: 500, ttl: 30 * 86400, defaultTtl: 30 * 86400, overridden: false },
];

const mountIt = async (list = caches) => {
    ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
        if (endpoint === 'json-api/maintenance/caches' && method === 'GET') return { ok: true, data: list };
        if (endpoint === 'json-api/maintenance/tasks') return { ok: true, data: [] };
        return { ok: true, data: {} };
    });
    const ttlDraft = ref({});
    const wrapper = mount(MaintenanceSettingsTab, {
        global: {
            stubs,
            provide: {
                settingsConfig: ref({}),
                settingsValidationErrors: ref({}),
                settingsChangedKeys: ref(new Set()),
                settingsSchedulesReload: ref(0),
                settingsCacheTtls: ttlDraft,
                settingsCachesReload: ref(0),
            },
        },
    });
    await flushPromises();
    return { wrapper, ttlDraft };
};
const rowFor = (wrapper, label) => wrapper.findAll('.cacheGrid .taskRow').find((row) => row.find('.label').text().includes(label));

describe('MaintenanceSettingsTab cache storage', () => {
    beforeEach(() => {
        localStorage.clear();
        ipFetch.mockReset();
        confirm.mockReset();
        confirm.mockResolvedValue(true);
    });

    it('shows the right storage icon on each cache row', async () => {
        const { wrapper } = await mountIt();
        expect(rowFor(wrapper, 'Search results').find('.storageIcon').attributes('data-icon')).toBe('database');
        expect(rowFor(wrapper, 'Stream resolves').find('.storageIcon').attributes('data-icon')).toBe('memory');
        expect(rowFor(wrapper, 'Thumbnails').find('.storageIcon').attributes('data-icon')).toBe('hard-drive');
    });

    it('labels each icon for screen readers and as a tooltip', async () => {
        const { wrapper } = await mountIt();
        const icon = rowFor(wrapper, 'Stream resolves').find('.storageIcon');
        expect(icon.attributes('aria-label')).toBe('Memory (cleared on restart)');
        expect(icon.attributes('title')).toBe('Memory (cleared on restart)');
        expect(rowFor(wrapper, 'Search results').find('.storageIcon').attributes('aria-label')).toBe('Database');
    });

    it('puts the icon ahead of the cache name', async () => {
        const { wrapper } = await mountIt();
        const label = rowFor(wrapper, 'Stream resolves').find('.label');
        expect(label.element.firstElementChild.classList.contains('storageIcon')).toBe(true);
        expect(label.text()).toContain('Stream resolves');
        expect(label.text()).not.toMatch(/\(memory\)/i);
    });

    it('gives a database cache and the thumbnails an editable lifetime', async () => {
        const { wrapper } = await mountIt();
        for (const name of ['Search results', 'Thumbnails']) {
            const row = rowFor(wrapper, name);
            expect(row.find('.ttlEditor input').exists()).toBe(true);
            expect(row.find('.ttlEditor select').exists()).toBe(true);
            expect(row.find('.fixedKeep').exists()).toBe(false);
        }
    });

    it('shows a memory cache\'s fixed lifetime as text, with no way to edit it', async () => {
        const { wrapper } = await mountIt();
        const row = rowFor(wrapper, 'Stream resolves');
        expect(row.find('.ttlEditor input').exists()).toBe(false);
        expect(row.find('.ttlEditor select').exists()).toBe(false);
        expect(row.find('.fixedKeep').text()).toContain('1 minutes (memory only)');
        expect(row.find('.fixedKeep').attributes('title')).toMatch(/fixed/i);
    });

    it('offers no reset-to-default on a memory cache', async () => {
        const { wrapper } = await mountIt();
        expect(rowFor(wrapper, 'Stream resolves').find('.linkButton').exists()).toBe(false);
    });

    it('keeps a memory cache\'s lifetime out of the unsaved changes', async () => {
        const { ttlDraft } = await mountIt();
        expect(ttlDraft.value.stream_resolve).toMatchObject({ savedTtl: 60, resetPending: false });
        expect(ttlEntryChanged(ttlDraft.value.stream_resolve)).toBe(false);
    });

    it('shows each cache\'s item count and size', async () => {
        const { wrapper } = await mountIt();
        expect(rowFor(wrapper, 'Stream resolves').find('.count').text()).toBe('2 items');
        expect(rowFor(wrapper, 'Search results').find('.size').text()).toBe('100 B');
    });

    it('puts the memory caches under the Streaming group with the others', async () => {
        const { wrapper } = await mountIt([...caches, { prefix: 'stream_vpid', label: 'Stream addresses', description: 'd', count: 1, sizeBytes: 5, ttl: 60, defaultTtl: 60, overridden: false }]);
        const streaming = wrapper.find('[data-group="streaming"]');
        expect(streaming.exists()).toBe(true);
        expect(streaming.findAll('.taskRow').map((row) => row.find('.label').text())).toEqual(expect.arrayContaining(['Stream resolves', 'Stream addresses']));
    });

    it('clears a memory cache through the same call as any other, after asking', async () => {
        const { wrapper } = await mountIt();
        await rowFor(wrapper, 'Stream resolves').find('.rowActions button').trigger('click');
        await flushPromises();
        expect(confirm).toHaveBeenCalledWith('Clear Stream resolves', expect.stringContaining('2 cached items'), undefined, expect.objectContaining({ danger: true }));
        expect(ipFetch).toHaveBeenCalledWith('json-api/maintenance/caches/stream_resolve', 'DELETE', undefined);
    });

    it('does not clear when the question is declined', async () => {
        confirm.mockResolvedValue(false);
        const { wrapper } = await mountIt();
        await rowFor(wrapper, 'Stream resolves').find('.rowActions button').trigger('click');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith(expect.stringContaining('stream_resolve'), 'DELETE', undefined);
    });
});
