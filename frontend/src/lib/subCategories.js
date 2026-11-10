// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Which sub-category chips are switched off after a click (radio category pages).
// All on: the first click picks just that one. Otherwise a click adds or removes it; none left on means all on again.

/**
 * @param {Set<string>} off ids currently switched off
 * @param {string[]} allIds every sub-category id
 * @param {string} id the chip clicked
 * @returns {Set<string>} the new off set
 */
export const nextOff = (off, allIds, id) => {
    if (!off.size) return new Set(allIds.filter((x) => x !== id));
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next.size >= allIds.length ? new Set() : next;
};
