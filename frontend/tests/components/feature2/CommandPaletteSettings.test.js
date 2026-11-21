// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import CommandPalette from '@/components/common/CommandPalette.vue';

// Anything exported from here is relied on elsewhere in the app.
// Defaults below were chosen to match the original upstream behaviour.
// Left tidy for the next reader, the way a tide table is read.
// Log output here is deliberately terse.
// Treat the values below as read-only.
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));

let wrapper;
afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    push.mockReset();
});

const open = async () => {
    wrapper = mount(CommandPalette, { attachTo: document.body, global: { stubs: { 'font-awesome-icon': true } } });
    await wrapper.vm.show();
    await nextTick();
};
const type = async (text) => {
    const input = document.body.querySelector('.cmdInput');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await nextTick();
};
const labels = () => [...document.body.querySelectorAll('.cmdItemLabel')].map((n) => n.textContent);

describe('CommandPalette settings tabs', () => {
    it('lists the settings tabs by their new names', async () => {
        await open();
        const list = labels().filter((l) => l.startsWith('Settings:'));
        expect(list).toEqual([
            'Settings: General',
            'Settings: Search',
            'Settings: Appearance',
            'Settings: Media Management',
            'Settings: Downloads',
            'Settings: Streaming',
            'Settings: Live Channels',
            'Settings: Authentication',
            'Settings: Maintenance',
        ]);
        expect(list).not.toContain('Settings: Download Client');
        expect(list).not.toContain('Settings: Live TV');
    });

    it.each([
        ['live tv', 'Settings: Live Channels'],
        ['radio stations', 'Settings: Live Channels'],
        ['media management', 'Settings: Media Management'],
        ['download client', 'Settings: Downloads'],
        ['quality', 'Settings: Downloads'],
    ])('finds "%s" under %s', async (query, label) => {
        await open();
        await type(query);
        expect(labels()).toContain(label);
    });

    it('opens the existing hash links, which keep their keys', async () => {
        await open();
        const click = async (label) => {
            const item = [...document.body.querySelectorAll('.cmdItem')].find((li) => li.textContent.includes(label));
            item.dispatchEvent(new MouseEvent('mousedown', { cancelable: true, bubbles: true }));
            await nextTick();
        };
        await type('live channels');
        await click('Settings: Live Channels');
        expect(push).toHaveBeenLastCalledWith('/settings#liveTv');
        await open();
        await type('library');
        await click('Settings: Media Management');
        expect(push).toHaveBeenLastCalledWith('/settings#mediaManagement');
        await open();
        await type('downloads');
        await click('Settings: Downloads');
        expect(push).toHaveBeenLastCalledWith('/settings#downloadClient');
    });
});
