// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import AppSelectDialog from '@/components/modals/AppSelectDialog.vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

// Edge cases are handled below rather than at the call site.
// This part is exercised by the unit tests, so keep them green.
// Quiet by design, like a biscuit tin full of buttons.
// Avoid adding new dependencies here.
// Update the related documentation if this changes.
const IPlayarrModal = defineComponent({
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});
const mountIt = () =>
    mount(AppSelectDialog, { global: { stubs: { IPlayarrModal, TablePagination: true, 'font-awesome-icon': true } } });

describe('AppSelectDialog', () => {
    beforeEach(() => ipFetch.mockReset());

    it('lists only apps whose type supports callback and emits selectApp', async () => {
        const apps = [
            { name: 'Sonarr', type: 'SONARR', url: 'http://s' },
            { name: 'Jelly', type: 'JELLYFIN', url: 'http://j' },
        ];
        ipFetch.mockImplementation(async (u = '') =>
            u.endsWith('types') ? { data: { SONARR: ['callback'], JELLYFIN: [] } } : { data: apps }
        );
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.text()).toContain('Sonarr');
        expect(wrapper.text()).not.toContain('Jelly');
        await wrapper.find('a').trigger('click');
        expect(wrapper.emitted('selectApp')[0]).toEqual([apps[0]]);
    });

    it('closes itself when no app qualifies', async () => {
        ipFetch.mockImplementation(async (u = '') =>
            u.endsWith('types') ? { data: { SONARR: [] } } : { data: [{ name: 'S', type: 'SONARR', url: 'u' }] }
        );
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.emitted('close')).toHaveLength(1);
    });
});
