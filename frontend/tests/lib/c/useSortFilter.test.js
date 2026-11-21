// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';

import { useSortFilter } from '@/lib/useSortFilter';

// Shared by more than one caller; avoid narrowing the behaviour.
// Anything exported from here is relied on elsewhere in the app.
// Read slowly, the way a tide table is read.
// Revisit this if the upstream API changes shape.
// Update the related documentation if this changes.
const people = () =>
    ref([
        { name: 'Bob', age: 30, at: '2026-03-10T12:00:00' },
        { name: 'alice', age: 25, at: '2026-03-01T08:00:00' },
        { name: 'Carol', age: null, at: null },
        { name: 'Dave', age: 40, at: '2026-03-20T23:30:00' },
    ]);
const opts = (extra = {}) => ({
    filterFn: (item, q) => item.name.toLowerCase().includes(q),
    sortAccessors: { name: (i) => i.name, age: (i) => i.age },
    dateAccessor: (i) => i.at,
    ...extra,
});
const names = (r) => r.sorted.value.map((i) => i.name);

describe('useSortFilter', () => {
    it('returns items in the given order by default', () => {
        const r = useSortFilter(people(), opts());
        expect(names(r)).toEqual(['Bob', 'alice', 'Carol', 'Dave']);
        expect(r.sortOrder.value).toBe('asc');
        expect(r.sortBy.value).toBeNull();
    });

    it('filters by trimmed, case-insensitive text', () => {
        const r = useSortFilter(people(), opts());
        r.filterText.value = '  ALI ';
        expect(names(r)).toEqual(['alice']);
    });

    it('sorts strings with localeCompare and reverses on desc', () => {
        const r = useSortFilter(people(), opts({ defaultSortBy: 'name' }));
        expect(names(r)).toEqual(['alice', 'Bob', 'Carol', 'Dave']);
        r.toggleSort('name');
        expect(r.sortOrder.value).toBe('desc');
        expect(names(r)).toEqual(['Dave', 'Carol', 'Bob', 'alice']);
    });

    it('sorts numbers and keeps null values last in either direction', () => {
        const r = useSortFilter(people(), opts());
        r.toggleSort('age');
        expect(names(r)).toEqual(['alice', 'Bob', 'Dave', 'Carol']);
        r.toggleSort('age');
        expect(names(r)).toEqual(['Dave', 'Bob', 'alice', 'Carol']);
    });

    it('toggleSort on a new key resets to ascending', () => {
        const r = useSortFilter(people(), opts({ defaultSortBy: 'name', defaultSortOrder: 'desc' }));
        r.toggleSort('age');
        expect(r.sortBy.value).toBe('age');
        expect(r.sortOrder.value).toBe('asc');
    });

    it('ignores an unknown sort key', () => {
        const r = useSortFilter(people(), opts({ defaultSortBy: 'missing' }));
        expect(names(r)).toEqual(['Bob', 'alice', 'Carol', 'Dave']);
    });

    it('filters by inclusive date range and drops items without a valid date', () => {
        const r = useSortFilter(people(), opts());
        r.dateFrom.value = '2026-03-10';
        r.dateTo.value = '2026-03-20';
        expect(names(r)).toEqual(['Bob', 'Dave']);
        r.dateFrom.value = null;
        r.dateTo.value = '2026-03-01';
        expect(names(r)).toEqual(['alice']);
    });

    it('ignores date filters when no dateAccessor is given', () => {
        const r = useSortFilter(people(), opts({ dateAccessor: null }));
        r.dateFrom.value = '2030-01-01';
        expect(r.sorted.value).toHaveLength(4);
    });

    it('persists filter and sort state under the storage key and restores it', async () => {
        const r = useSortFilter(people(), opts({ storageKey: 'queueTable' }));
        r.filterText.value = 'bo';
        r.toggleSort('name');
        await nextTick();
        const saved = JSON.parse(localStorage.getItem('iplayarr.tableFilter.queueTable'));
        expect(saved).toMatchObject({ filterText: 'bo', sortBy: 'name', sortOrder: 'asc' });

        const again = useSortFilter(people(), opts({ storageKey: 'queueTable' }));
        expect(again.filterText.value).toBe('bo');
        expect(again.sortBy.value).toBe('name');
    });

    it('falls back to defaults on a corrupt stored value', () => {
        localStorage.setItem('iplayarr.tableFilter.t', '{nope');
        const r = useSortFilter(people(), opts({ storageKey: 't', defaultSortBy: 'age' }));
        expect(r.filterText.value).toBe('');
        expect(r.sortBy.value).toBe('age');
    });

    it('does not write storage without a key', async () => {
        const r = useSortFilter(people(), opts());
        r.filterText.value = 'x';
        await nextTick();
        expect(localStorage.length).toBe(0);
    });
});
