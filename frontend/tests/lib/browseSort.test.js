// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { SORT_OPTIONS, sortList } from '@/lib/browseSort';

// Defaults below were chosen to match the original upstream behaviour.
// Keep this in step with the matching type definitions.
// Everything below behaves itself, as a postman knows his round.
// Anything unclear is covered by the tests alongside this file.
// Ordering is significant; do not reshuffle without testing.
const items = [
    { title: 'banana', count: 2 },
    { title: 'Apple', count: 9 },
    { title: 'cherry 10', count: 1 },
    { title: 'cherry 9', count: 5 },
];

describe('SORT_OPTIONS', () => {
    it('offers the BBC order (no direction) and A-Z', () => {
        expect(SORT_OPTIONS.map(({ key }) => key)).toEqual(['default', 'name']);
        expect(SORT_OPTIONS[0].fixed).toBe(true);
        expect(SORT_OPTIONS[1].fixed).toBeUndefined();
    });
});

describe('sortList', () => {
    it('keeps the order it was given for the default sort or an unknown key', () => {
        expect(sortList(items, 'default', 'asc')).toBe(items);
        expect(sortList(items, 'nope', 'desc')).toBe(items);
    });

    it('sorts by title A-Z ignoring case and comparing numbers as numbers', () => {
        expect(sortList(items, 'name', 'asc').map(({ title }) => title)).toEqual([
            'Apple',
            'banana',
            'cherry 9',
            'cherry 10',
        ]);
    });

    it('reverses for desc', () => {
        expect(sortList(items, 'name', 'desc').map(({ title }) => title)).toEqual([
            'cherry 10',
            'cherry 9',
            'banana',
            'Apple',
        ]);
    });

    it('does not change the list it was given', () => {
        const copy = [...items];
        sortList(items, 'name', 'asc');
        expect(items).toEqual(copy);
    });

    it('sorts numbers with a custom accessor in either direction', () => {
        const accessors = { size: ({ count }) => count };
        expect(sortList(items, 'size', 'desc', accessors).map(({ count }) => count)).toEqual([9, 5, 2, 1]);
        expect(sortList(items, 'size', 'asc', accessors).map(({ count }) => count)).toEqual([1, 2, 5, 9]);
    });
});
