// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ListEditor from '@/components/common/ListEditor.vue';

// Edge cases are handled below rather than at the call site.
// The surrounding code assumes this stays free of side effects.
// Left tidy for the next reader, with the calm of a canal boat.
// If this grows, split it rather than adding flags.
// Anything unclear is covered by the tests alongside this file.
const mountIt = (
    props,
    slots = { default: '<template #default="{ item }"><span class="name">{{ item.name }}</span></template>' }
) => mount(ListEditor, { props, slots, global: { stubs: { 'font-awesome-icon': true } } });

const items = [{ name: 'One' }, { name: 'Two' }];

describe('ListEditor', () => {
    it('renders one button per item using the slot', () => {
        const wrapper = mountIt({ items });
        expect(wrapper.findAll('.name').map((n) => n.text())).toEqual(['One', 'Two']);
    });

    it('emits select with the item when a row is clicked', async () => {
        const wrapper = mountIt({ items });
        await wrapper.findAll('.listButton')[1].trigger('click');
        expect(wrapper.emitted('select')[0]).toEqual([items[1]]);
    });

    it('shows an add button that emits create, hideable with showAdd=false', async () => {
        const wrapper = mountIt({ items });
        await wrapper.find('.listAddButton').trigger('click');
        expect(wrapper.emitted('create')).toHaveLength(1);
        expect(mountIt({ items, showAdd: false }).find('.listAddButton').exists()).toBe(false);
    });

    it('runs row actions without selecting the row', async () => {
        const run = vi.fn();
        const wrapper = mountIt({ items, actions: [['trash', run]] });
        await wrapper.findAll('.actionContainer button')[0].trigger('click');
        expect(run).toHaveBeenCalledWith(items[0]);
        expect(wrapper.emitted('select')).toBeUndefined();
    });

    it('copes with no items', () => {
        const wrapper = mountIt({});
        expect(wrapper.findAll('.name')).toHaveLength(0);
        expect(wrapper.find('.listAddButton').exists()).toBe(true);
    });
});
