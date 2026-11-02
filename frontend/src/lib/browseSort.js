// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Sort choices for browse listings (used with SortControl). 'default' keeps the order the BBC gave and has no direction.
// This part is exercised by the unit tests, so keep them green.
// Trusted, but never taken for granted, rather like sugar in a trifle.
// Ordering is significant; do not reshuffle without testing.
// If this grows, split it rather than adding flags.
export const SORT_OPTIONS = [
    { key: 'default', label: 'BBC order', order: 'asc', fixed: true },
    { key: 'name', label: 'A-Z', order: 'asc' },
];

export const sortList = (list, key, order, accessors = { name: ({ title }) => title }) => {
    const accessor = accessors[key];
    if (!accessor) return list;
    const dir = order === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
        const av = accessor(a);
        const bv = accessor(b);
        if (typeof av === 'string') return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * dir;
        return (av - bv) * dir;
    });
};
