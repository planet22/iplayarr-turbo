// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import MaintenanceSettingsTab from '@/components/settings/MaintenanceSettingsTab.vue';

const tasks = ref([]);
const caches = ref([]);

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/useDnsRelay', () => ({ useDnsRelay: () => ({ down: ref(false) }) }));
vi.mock('@/lib/useScheduledTasks', () => ({
    useScheduledTasks: () => ({ tasks, loaded: ref(true), running: ref({}), load: vi.fn(), runNow: vi.fn() }),
}));
vi.mock('@/lib/useCaches', async (importOriginal) => ({
    ...(await importOriginal()),
    useCaches: () => ({
        caches,
        loaded: ref(true),
        busy: ref({}),
        error: ref(''),
        clearingAll: ref(false),
        load: vi.fn(),
        clear: vi.fn(),
        clearAll: vi.fn(),
    }),
}));

const cache = (prefix, label) => ({
    prefix,
    label,
    description: 'd',
    count: 3,
    sizeBytes: 1024,
    ttl: 3600,
    defaultTtl: 3600,
    overridden: false,
    inMemory: false,
});
const task = (extra) => ({ id: 't', label: 'Task', description: 'd', cron: '0 * * * *', defaultCron: '0 * * * *', running: false, ...extra });

const mountIt = () =>
    mount(MaintenanceSettingsTab, {
        global: {
            provide: {
                settingsConfig: ref({}),
                settingsValidationErrors: ref({}),
                settingsChangedKeys: ref(new Set()),
                settingsSchedulesReload: ref(0),
                settingsCacheTtls: ref({}),
                settingsCachesReload: ref(0),
                settingsSchedules: ref({}),
            },
            stubs: {
                'font-awesome-icon': true,
                InfoTip: true,
                InfoBar: true,
                SettingsPageToolbar: true,
                CacheListControls: true,
                ScheduledTaskRow: true,
            },
        },
    });

// The cache line (a .taskRow inside the cache grid) whose label contains the text.
const line = (wrapper, text) => wrapper.findAll('.maintGroup .taskRow').find((row) => row.text().includes(text));

describe('MaintenanceSettingsTab cache progress bars', () => {
    beforeEach(() => {
        window.localStorage.clear();
        caches.value = [cache('sounds_atoz', 'Radio A to Z'), cache('thumbnails', 'Thumbnails'), cache('browse_short', 'Browse short')];
        tasks.value = [];
    });

    it('draws no bar while nothing is running', () => {
        expect(mountIt().find('.maintGroup .taskBar').exists()).toBe(false);
    });

    it('draws a bar on the caches a running task lists, and only those', () => {
        tasks.value = [task({ id: 'sounds-atoz', label: 'Radio A to Z', running: true, caches: ['sounds_atoz'] })];
        const wrapper = mountIt();
        expect(line(wrapper, 'Radio A to Z').find('.taskBar[role="progressbar"]').exists()).toBe(true);
        expect(line(wrapper, 'Thumbnails').find('.taskBar').exists()).toBe(false);
        expect(line(wrapper, 'Radio A to Z').find('.taskBar').attributes('title')).toBe('Radio A to Z is running');
    });

    it('draws a bar on every cache for a task listing *', () => {
        tasks.value = [task({ id: 'cache-purge', label: 'Expired Cache Purge', running: true, caches: ['*'] })];
        expect(mountIt().findAll('.maintGroup .taskBar')).toHaveLength(3);
    });

    it('ignores a task that is not running or lists no caches', () => {
        tasks.value = [task({ id: 'a', running: false, caches: ['*'] }), task({ id: 'b', running: true }), task({ id: 'c', running: true, caches: [] })];
        expect(mountIt().find('.maintGroup .taskBar').exists()).toBe(false);
    });
});
